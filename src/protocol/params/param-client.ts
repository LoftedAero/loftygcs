// Parameter transfer over the classic message path: the fallback that works
// on every ArduPilot ever shipped. PARAM_REQUEST_LIST streams PARAM_VALUEs;
// gaps are refetched by index; writes are PARAM_SET verified by the echoed
// PARAM_VALUE. The MAVFTP fast path (param-ftp) is layered in front of
// this, so this path must always work.
//
// Timeouts come from the measured link round trip (link-timing), with the
// constants below as floors, so a slow radio link is given the patience it
// needs while USB and SITL behave as before.
import { backoff, type RttEstimator } from '../link-timing'
import type { FieldValue } from '../types'

export interface ParamRecord {
  name: string
  value: number
  /** MAV_PARAM_TYPE as reported by the vehicle. */
  mavType: number
}

interface SendFn {
  (msgName: string, fields: Record<string, FieldValue>): void
}

const STALL_TIMEOUT_MS = 3000
/** Refetch requests in flight at once: enough to keep a slow link busy without queueing a flood behind the telemetry. */
const REFETCH_WINDOW = 8
const REFETCH_TIMEOUT_MS = 1000
/** Unanswered requests for one parameter before the download gives up. */
const REFETCH_TRIES = 6
const SET_TIMEOUT_MS = 1500
const SET_RETRIES = 3

interface Refetch {
  queue: number[]
  inflight: Map<number, ReturnType<typeof setTimeout>>
  tries: Map<number, number>
}

export class ParamStreamClient {
  private received = new Map<number, ParamRecord>()
  private byName = new Map<string, ParamRecord>()
  private total = 0
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private active: {
    resolve: (params: ParamRecord[]) => void
    reject: (e: Error) => void
    onProgress: (got: number, total: number) => void
    refetch: Refetch | null
  } | null = null
  private pendingSets = new Map<
    string,
    {
      resolve: (v: number) => void
      timer: ReturnType<typeof setTimeout>
      sentAt: number
      firstAttempt: boolean
    }
  >()

  constructor(
    private send: SendFn,
    private target: () => { sysid: number; compid: number },
    private rtt?: RttEstimator,
  ) {}

  /** A reply timeout for the given retry (0 for the first send). */
  private wait(floorMs: number, attempt = 0): number {
    return this.rtt?.timeout(floorMs, attempt) ?? backoff(floorMs, attempt)
  }

  /** Feed every PARAM_VALUE here. */
  handleParamValue(fields: Record<string, FieldValue>) {
    const record: ParamRecord = {
      name: (fields.paramId as string).trim(),
      value: fields.paramValue as number,
      mavType: fields.paramType as number,
    }
    const index = fields.paramIndex as number
    this.total = fields.paramCount as number

    // A PARAM_SET echo has index 65535; it also must not disturb a download.
    if (index !== 65535) {
      this.received.set(index, record)
    }
    this.byName.set(record.name, record)

    const set = this.pendingSets.get(record.name)
    if (set) {
      this.pendingSets.delete(record.name)
      clearTimeout(set.timer)
      if (set.firstAttempt) this.rtt?.sample(Date.now() - set.sentAt)
      set.resolve(record.value)
    }

    const a = this.active
    if (!a) return
    a.onProgress(this.received.size, this.total)
    if (this.received.size >= this.total && this.total > 0) {
      this.finish()
      return
    }
    if (a.refetch) {
      const timer = a.refetch.inflight.get(index)
      if (timer !== undefined) {
        clearTimeout(timer)
        a.refetch.inflight.delete(index)
      }
      this.pumpRefetch()
    } else {
      this.bumpStall()
    }
  }

  downloadAll(onProgress: (got: number, total: number) => void): Promise<ParamRecord[]> {
    if (this.active) return Promise.reject(new Error('param download already running'))
    this.received.clear()
    const t = this.target()
    return new Promise((resolve, reject) => {
      this.active = { resolve, reject, onProgress, refetch: null }
      this.send('PARAM_REQUEST_LIST', { targetSystem: t.sysid, targetComponent: t.compid })
      this.bumpStall()
    })
  }

  /** The stream went quiet: either done-with-gaps or dead. */
  private bumpStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = setTimeout(() => this.onStall(), this.wait(STALL_TIMEOUT_MS))
  }

  private onStall() {
    const a = this.active
    if (!a || a.refetch) return
    if (this.total === 0) {
      this.fail(new Error('no PARAM_VALUE received'))
      return
    }
    const missing: number[] = []
    for (let i = 0; i < this.total; i++) if (!this.received.has(i)) missing.push(i)
    if (missing.length === 0) {
      this.finish()
      return
    }
    // Ask for the gaps by index, a few at a time, each on its own timeout.
    a.refetch = { queue: missing, inflight: new Map(), tries: new Map() }
    this.clearStall()
    this.pumpRefetch()
  }

  private pumpRefetch() {
    const r = this.active?.refetch
    if (!r) return
    const t = this.target()
    while (r.inflight.size < REFETCH_WINDOW && r.queue.length > 0) {
      const i = r.queue.shift()!
      if (this.received.has(i)) continue
      this.send('PARAM_REQUEST_READ', {
        targetSystem: t.sysid,
        targetComponent: t.compid,
        paramId: '',
        paramIndex: i,
      })
      r.inflight.set(
        i,
        setTimeout(
          () => this.onRefetchTimeout(i),
          this.wait(REFETCH_TIMEOUT_MS, r.tries.get(i) ?? 0),
        ),
      )
    }
  }

  private onRefetchTimeout(index: number) {
    const r = this.active?.refetch
    if (!r) return
    r.inflight.delete(index)
    const tries = (r.tries.get(index) ?? 0) + 1
    r.tries.set(index, tries)
    if (tries >= REFETCH_TRIES) {
      const missing = this.total - this.received.size
      this.fail(new Error(`param download incomplete: ${missing} of ${this.total} missing`))
      return
    }
    r.queue.push(index)
    this.pumpRefetch()
  }

  private finish() {
    const a = this.active
    if (!a) return
    this.clearStall()
    this.clearRefetch()
    this.active = null
    a.resolve([...this.received.entries()].sort(([x], [y]) => x - y).map(([, r]) => r))
  }

  private fail(err: Error) {
    const a = this.active
    if (!a) return
    this.clearStall()
    this.clearRefetch()
    this.active = null
    a.reject(err)
  }

  private clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = null
  }

  private clearRefetch() {
    const r = this.active?.refetch
    if (!r) return
    for (const timer of r.inflight.values()) clearTimeout(timer)
    r.inflight.clear()
  }

  /** Write one parameter and resolve with the vehicle's echoed value. */
  setParam(name: string, value: number, mavType: number): Promise<number> {
    const t = this.target()
    const attempt = (retriesLeft: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.pendingSets.delete(name)
            if (retriesLeft > 0) attempt(retriesLeft - 1).then(resolve, reject)
            else reject(new Error(`${name}: no reply from the vehicle`))
          },
          this.wait(SET_TIMEOUT_MS, SET_RETRIES - retriesLeft),
        )
        this.pendingSets.set(name, {
          resolve,
          timer,
          sentAt: Date.now(),
          firstAttempt: retriesLeft === SET_RETRIES,
        })
        this.send('PARAM_SET', {
          targetSystem: t.sysid,
          targetComponent: t.compid,
          paramId: name,
          paramValue: value,
          paramType: mavType,
        })
      })
    return attempt(SET_RETRIES)
  }

  abort(reason: string) {
    this.fail(new Error(reason))
    for (const [, s] of this.pendingSets) clearTimeout(s.timer)
    this.pendingSets.clear()
  }
}
