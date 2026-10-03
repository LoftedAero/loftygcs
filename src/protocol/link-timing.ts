// Round-trip time of the link, estimated the way TCP does (RFC 6298): a
// smoothed mean and a mean deviation, updated from each measured exchange.
// Every request/response client takes its reply timeout from here, so a slow
// radio link (ELRS at a low packet rate answers in seconds) gets patience in
// proportion while USB and SITL keep their original, short timeouts as floors.

/** Longest any single wait is allowed to grow; beyond this the link is gone. */
const MAX_TIMEOUT_MS = 10000

export class RttEstimator {
  private srtt: number | null = null
  private rttvar = 0

  /** Record one measured request-to-reply time. */
  sample(ms: number) {
    if (!(ms >= 0) || !Number.isFinite(ms)) return
    if (this.srtt === null) {
      this.srtt = ms
      this.rttvar = ms / 2
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - ms)
      this.srtt = 0.875 * this.srtt + 0.125 * ms
    }
  }

  /** Smoothed round trip in milliseconds, or null before the first sample. */
  get rttMs(): number | null {
    return this.srtt
  }

  /**
   * How long to wait for a reply: the caller's own timeout, or longer when
   * the measured link needs it. Each retry waits twice as long as the one
   * before (`attempt` counts from 0), because a reply that missed one
   * timeout is usually queued behind other traffic, not lost.
   */
  timeout(floorMs: number, attempt = 0): number {
    return backoff(
      this.srtt === null
        ? floorMs
        : Math.max(floorMs, Math.min(MAX_TIMEOUT_MS, this.srtt + 4 * this.rttvar)),
      attempt,
    )
  }

  reset() {
    this.srtt = null
    this.rttvar = 0
  }
}

/** `ms` doubled per retry, capped; for callers with no estimator. */
export function backoff(ms: number, attempt: number): number {
  return Math.min(Math.max(ms, MAX_TIMEOUT_MS), ms * 2 ** attempt)
}
