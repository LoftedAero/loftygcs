// Parameter transfer over the classic message path: the fallback that works
// on every ArduPilot ever shipped. PARAM_REQUEST_LIST streams PARAM_VALUEs;
// gaps are refetched by index; writes are PARAM_SET verified by the echoed
// PARAM_VALUE. The MAVFTP fast path (param-ftp) is an optimization layered
// in front of this -- this path must always work.
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
const GAP_RETRY_LIMIT = 3
const SET_TIMEOUT_MS = 1500
const SET_RETRIES = 2

export class ParamStreamClient {
  private received = new Map<number, ParamRecord>()
  private byName = new Map<string, ParamRecord>()
  private total = 0
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private active: {
    resolve: (params: ParamRecord[]) => void
    reject: (e: Error) => void
    onProgress: (got: number, total: number) => void
    gapRetries: number
  } | null = null
  private pendingSets = new Map<
    string,
    { resolve: (v: number) => void; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(
    private send: SendFn,
    private target: () => { sysid: number; compid: number },
  ) {}

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
      set.resolve(record.value)
    }

    if (this.active) {
      this.active.onProgress(this.received.size, this.total)
      this.bumpStall()
      if (this.received.size >= this.total && this.total > 0) this.finish()
    }
  }

  downloadAll(onProgress: (got: number, total: number) => void): Promise<ParamRecord[]> {
    if (this.active) return Promise.reject(new Error('param download already running'))
    this.received.clear()
    const t = this.target()
    return new Promise((resolve, reject) => {
      this.active = { resolve, reject, onProgress, gapRetries: 0 }
      this.send('PARAM_REQUEST_LIST', { targetSystem: t.sysid, targetComponent: t.compid })
      this.bumpStall()
    })
  }

  /** The stream went quiet: either done-with-gaps or dead. */
  private bumpStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = setTimeout(() => this.onStall(), STALL_TIMEOUT_MS)
  }

  private onStall() {
    const a = this.active
    if (!a) return
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
    if (a.gapRetries >= GAP_RETRY_LIMIT) {
      this.fail(new Error(`param download incomplete: ${missing.length} of ${this.total} missing`))
      return
    }
    a.gapRetries++
    const t = this.target()
    // Refetch by index, a bounded batch per stall round.
    for (const i of missing.slice(0, 50)) {
      this.send('PARAM_REQUEST_READ', {
        targetSystem: t.sysid,
        targetComponent: t.compid,
        paramId: '',
        paramIndex: i,
      })
    }
    this.bumpStall()
  }

  private finish() {
    const a = this.active
    if (!a) return
    this.clearStall()
    this.active = null
    a.resolve([...this.received.entries()].sort(([x], [y]) => x - y).map(([, r]) => r))
  }

  private fail(err: Error) {
    const a = this.active
    if (!a) return
    this.clearStall()
    this.active = null
    a.reject(err)
  }

  private clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = null
  }

  /** Write one parameter and resolve with the vehicle's echoed value. */
  setParam(name: string, value: number, mavType: number): Promise<number> {
    const t = this.target()
    const attempt = (retriesLeft: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingSets.delete(name)
          if (retriesLeft > 0) attempt(retriesLeft - 1).then(resolve, reject)
          else reject(new Error(`PARAM_SET ${name}: no echo from vehicle`))
        }, SET_TIMEOUT_MS)
        this.pendingSets.set(name, { resolve, timer })
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
