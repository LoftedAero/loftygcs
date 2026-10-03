// COMMAND_LONG with COMMAND_ACK tracking: every command gets a definite
// answer (accepted, rejected with a result code, or no reply), so a command
// can never fail silently.
import { backoff, type RttEstimator } from './link-timing'
import type { FieldValue } from './types'

/** MAV_RESULT names for the codes wizards care about. */
export const MAV_RESULT: Record<number, string> = {
  0: 'Accepted',
  1: 'Temporarily rejected',
  2: 'Denied',
  3: 'Unsupported',
  4: 'Failed',
  5: 'In progress',
  6: 'Canceled',
}

const ACK_TIMEOUT_MS = 1500
const RETRIES = 2

interface Pending {
  resolve: (result: number) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
  sentAt: number
  /** Only an answer to the first send is a clean round-trip sample. */
  firstAttempt: boolean
}

export class CommandClient {
  private pending = new Map<number, Pending>()

  constructor(
    private send: (msgName: string, fields: Record<string, FieldValue>) => void,
    private target: () => { sysid: number; compid: number },
    private rtt?: RttEstimator,
  ) {}

  /** Feed every COMMAND_ACK here. */
  handleAck(fields: Record<string, FieldValue>) {
    const command = fields.command as number
    const result = fields.result as number
    const p = this.pending.get(command)
    if (!p) return
    // IN_PROGRESS(5) acks arrive for long operations; keep waiting for the
    // final verdict rather than resolving on the progress note.
    if (result === 5) return
    this.pending.delete(command)
    clearTimeout(p.timer)
    if (p.firstAttempt) this.rtt?.sample(Date.now() - p.sentAt)
    p.resolve(result)
  }

  /**
   * Send a command and resolve with the MAV_RESULT. A non-zero result
   * resolves rather than rejects; only a missing ack rejects.
   */
  run(command: number, params: number[] = [], opts?: { timeoutMs?: number }): Promise<number> {
    const floorMs = opts?.timeoutMs ?? ACK_TIMEOUT_MS
    const t = this.target()
    const attempt = (retriesLeft: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => {
            this.pending.delete(command)
            if (retriesLeft > 0) attempt(retriesLeft - 1).then(resolve, reject)
            else reject(new Error(`Command ${command}: no reply from the vehicle`))
          },
          this.rtt?.timeout(floorMs, RETRIES - retriesLeft) ??
            backoff(floorMs, RETRIES - retriesLeft),
        )
        this.pending.set(command, {
          resolve,
          reject,
          timer,
          sentAt: Date.now(),
          firstAttempt: retriesLeft === RETRIES,
        })
        this.send('COMMAND_LONG', {
          targetSystem: t.sysid,
          targetComponent: t.compid,
          command,
          confirmation: 0,
          _param1: params[0] ?? 0,
          _param2: params[1] ?? 0,
          _param3: params[2] ?? 0,
          _param4: params[3] ?? 0,
          _param5: params[4] ?? 0,
          _param6: params[5] ?? 0,
          _param7: params[6] ?? 0,
        })
      })
    return attempt(RETRIES)
  }

  abort(reason: string) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
  }
}
