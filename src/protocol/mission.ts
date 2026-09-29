// Mission transfer, the MAVLink way: the side *receiving* items drives the
// exchange. Downloading, we ask for each item by sequence and the vehicle
// answers; uploading, we announce a count and then answer whatever the
// vehicle requests, in whatever order and however many times it asks. Both
// directions end with a MISSION_ACK, and an upload only counts once that ack
// says accepted. A mission that dies halfway leaves the vehicle with its old
// plan, not half of the new one.
//
// Parameterized by mission_type because geofences and rally points use the
// same handshake with a different type value.
import { backoff, type RttEstimator } from './link-timing'
import type { FieldValue, MissionItem } from './types'

/** MAV_MISSION_RESULT names, for turning a rejected upload into a sentence. */
export const MAV_MISSION_RESULT: Record<number, string> = {
  0: 'Accepted',
  1: 'Error',
  2: 'Unsupported frame',
  3: 'Unsupported',
  4: 'No space on vehicle',
  5: 'Invalid item',
  6: 'Invalid param1',
  7: 'Invalid param2',
  8: 'Invalid param3',
  9: 'Invalid param4',
  10: 'Invalid latitude',
  11: 'Invalid longitude',
  12: 'Invalid altitude',
  13: 'Invalid sequence',
  14: 'Denied',
  15: 'Canceled',
}

export const MISSION_TYPE = { mission: 0, fence: 1, rally: 2 } as const

interface SendFn {
  (msgName: string, fields: Record<string, FieldValue>): void
}

type Progress = (got: number, total: number) => void

interface Download {
  kind: 'download'
  items: MissionItem[]
  /** null until MISSION_COUNT arrives. */
  total: number | null
  onProgress: Progress
  resolve: (items: MissionItem[]) => void
  reject: (e: Error) => void
}

interface Upload {
  kind: 'upload'
  items: MissionItem[]
  onProgress: Progress
  resolve: () => void
  reject: (e: Error) => void
  /** Highest sequence the vehicle has asked for, for progress and stalls. */
  lastRequested: number
}

interface Clear {
  kind: 'clear'
  resolve: () => void
  reject: (e: Error) => void
}

type Active = (Download | Upload | Clear) & { missionType: number; retries: number }

// Timeouts per step grow with the measured link round trip (link-timing);
// stepTimeoutMs is the floor.
const STEP_RETRIES = 5

export class MissionClient {
  private active: Active | null = null
  private stepTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private send: SendFn,
    private target: () => { sysid: number; compid: number },
    private stepTimeoutMs = 1500,
    private rtt?: RttEstimator,
  ) {}

  /**
   * Feed MISSION_COUNT, MISSION_ITEM_INT, MISSION_REQUEST(_INT) and
   * MISSION_ACK here. Anything arriving with no transfer running is a
   * leftover from a dead one and is dropped.
   */
  handleMessage(msgName: string, fields: Record<string, FieldValue>) {
    const a = this.active
    if (!a) return
    // Old firmware omits mission_type on some messages; the decoder then
    // yields 0, which matches only the primary mission. That firmware has no
    // other kind.
    const mt = (fields.missionType as number) ?? 0
    if (mt !== a.missionType) return

    switch (msgName) {
      case 'MISSION_COUNT': {
        if (a.kind !== 'download') return
        // A duplicate COUNT (their retry crossing ours) must not reset a
        // transfer that is already receiving items.
        if (a.total !== null) return
        a.total = fields.count as number
        a.retries = 0
        if (a.total === 0) {
          this.sendAck(0, a.missionType)
          this.finish(() => a.resolve([]))
          return
        }
        this.requestItem(0, a.missionType)
        return
      }
      case 'MISSION_ITEM_INT': {
        if (a.kind !== 'download' || a.total === null) return
        const seq = fields.seq as number
        // Only the item we asked for advances the transfer; duplicates from
        // crossed retries and stale answers are dropped, and anything ahead
        // of us will be re-requested in order.
        if (seq !== a.items.length) return
        a.items.push({
          seq,
          frame: fields.frame as number,
          command: fields.command as number,
          current: fields.current as number,
          autocontinue: fields.autocontinue as number,
          param1: fields.param1 as number,
          param2: fields.param2 as number,
          param3: fields.param3 as number,
          param4: fields.param4 as number,
          x: fields.x as number,
          y: fields.y as number,
          z: fields.z as number,
        })
        a.retries = 0
        a.onProgress(a.items.length, a.total)
        if (a.items.length >= a.total) {
          this.sendAck(0, a.missionType)
          const items = a.items
          this.finish(() => a.resolve(items))
        } else {
          this.requestItem(a.items.length, a.missionType)
        }
        return
      }
      // The vehicle asks for items by whichever message its firmware speaks;
      // the answer is MISSION_ITEM_INT either way (the spec's own upgrade
      // path for the deprecated float message).
      case 'MISSION_REQUEST':
      case 'MISSION_REQUEST_INT': {
        if (a.kind !== 'upload') return
        const seq = fields.seq as number
        const item = a.items[seq]
        if (!item) return
        a.retries = 0
        a.lastRequested = Math.max(a.lastRequested, seq)
        a.onProgress(seq + 1, a.items.length)
        this.sendItem(item, a.missionType)
        this.bumpStep()
        return
      }
      case 'MISSION_ACK': {
        const result = fields.type as number
        // Downloads are acked by us, not the vehicle, but an error ack is the
        // vehicle refusing to serve the list at all.
        if (a.kind === 'download' && result === 0) return
        // ArduPilot answers an item it did not ask for, such as our resend
        // crossing its next request on a slow link, with INVALID_SEQUENCE and
        // keeps waiting for the one it wants. The upload is still alive.
        if (a.kind === 'upload' && result === 13) return
        if (result === 0) {
          this.finish(() => (a as Upload | Clear).resolve())
        } else {
          const name = MAV_MISSION_RESULT[result] ?? `result ${result}`
          const seq =
            a.kind === 'upload' && a.lastRequested >= 0 ? ` (item ${a.lastRequested})` : ''
          this.finish(() => a.reject(new Error(`Mission transfer refused: ${name}${seq}`)))
        }
        return
      }
    }
  }

  /** Read the vehicle's stored mission. Item 0 is home. */
  download(missionType = 0, onProgress: Progress = () => {}): Promise<MissionItem[]> {
    return this.begin<MissionItem[]>((resolve, reject) => {
      this.active = {
        kind: 'download',
        items: [],
        total: null,
        missionType,
        retries: 0,
        onProgress,
        resolve,
        reject,
      }
      this.sendRequestList(missionType)
    })
  }

  /**
   * Replace the vehicle's mission. Items must be complete and contiguous
   * from seq 0 (the planned home); this layer transfers what it is given.
   */
  upload(items: MissionItem[], missionType = 0, onProgress: Progress = () => {}): Promise<void> {
    return this.begin<void>((resolve, reject) => {
      this.active = {
        kind: 'upload',
        items,
        missionType,
        retries: 0,
        lastRequested: -1,
        onProgress,
        resolve,
        reject,
      }
      this.sendCount(items.length, missionType)
    })
  }

  clearAll(missionType = 0): Promise<void> {
    return this.begin<void>((resolve, reject) => {
      this.active = { kind: 'clear', missionType, retries: 0, resolve, reject }
      const t = this.target()
      this.send('MISSION_CLEAR_ALL', {
        targetSystem: t.sysid,
        targetComponent: t.compid,
        missionType,
      })
    })
  }

  abort(reason: string) {
    const a = this.active
    if (!a) return
    this.finish(() => a.reject(new Error(reason)))
  }

  private begin<T>(
    start: (resolve: (v: T) => void, reject: (e: Error) => void) => void,
  ): Promise<T> {
    if (this.active) {
      return Promise.reject(new Error('a mission transfer is already running'))
    }
    return new Promise<T>((resolve, reject) => {
      start(resolve, reject)
      this.bumpStep()
    })
  }

  /**
   * The other side went quiet. Resend whatever it should be reacting to: the
   * request a download is stuck on, or for an upload the count (nothing
   * requested yet) or the last item (its next request or ack got lost).
   * Bounded, then the transfer fails with what stalled.
   */
  private onStepTimeout() {
    const a = this.active
    if (!a) return
    if (a.retries >= STEP_RETRIES) {
      const at =
        a.kind === 'download'
          ? a.total === null
            ? 'no MISSION_COUNT from vehicle'
            : `no item ${a.items.length} of ${a.total}`
          : a.kind === 'upload'
            ? a.lastRequested < 0
              ? 'vehicle never requested items'
              : `stalled after item ${a.lastRequested}`
            : 'no MISSION_ACK for clear'
      this.finish(() => a.reject(new Error(`Mission transfer timed out: ${at}`)))
      return
    }
    a.retries++
    if (a.kind === 'download') {
      if (a.total === null) this.sendRequestList(a.missionType)
      else this.requestItem(a.items.length, a.missionType)
    } else if (a.kind === 'upload') {
      if (a.lastRequested < 0) this.sendCount(a.items.length, a.missionType)
      else {
        const item = a.items[a.lastRequested]
        if (item) this.sendItem(item, a.missionType)
      }
    } else {
      const t = this.target()
      this.send('MISSION_CLEAR_ALL', {
        targetSystem: t.sysid,
        targetComponent: t.compid,
        missionType: a.missionType,
      })
    }
    this.bumpStep()
  }

  private bumpStep() {
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = setTimeout(
      () => this.onStepTimeout(),
      this.rtt?.timeout(this.stepTimeoutMs, this.active?.retries ?? 0) ??
        backoff(this.stepTimeoutMs, this.active?.retries ?? 0),
    )
  }

  private finish(deliver: () => void) {
    if (this.stepTimer) clearTimeout(this.stepTimer)
    this.stepTimer = null
    this.active = null
    deliver()
  }

  private sendRequestList(missionType: number) {
    const t = this.target()
    this.send('MISSION_REQUEST_LIST', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      missionType,
    })
  }

  private sendCount(count: number, missionType: number) {
    const t = this.target()
    this.send('MISSION_COUNT', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      count,
      missionType,
    })
  }

  private requestItem(seq: number, missionType: number) {
    const t = this.target()
    this.send('MISSION_REQUEST_INT', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      seq,
      missionType,
    })
    this.bumpStep()
  }

  private sendItem(item: MissionItem, missionType: number) {
    const t = this.target()
    this.send('MISSION_ITEM_INT', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      seq: item.seq,
      frame: item.frame,
      command: item.command,
      current: item.current,
      autocontinue: item.autocontinue,
      param1: item.param1,
      param2: item.param2,
      param3: item.param3,
      param4: item.param4,
      x: item.x,
      y: item.y,
      z: item.z,
      missionType,
    })
  }

  private sendAck(result: number, missionType: number) {
    const t = this.target()
    this.send('MISSION_ACK', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      type: result,
      missionType,
    })
  }
}
