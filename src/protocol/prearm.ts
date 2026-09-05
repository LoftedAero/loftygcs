// Why the vehicle will not arm.
//
// ArduPilot already answers this precisely -- "PreArm: Compass not
// calibrated", "PreArm: GPS horizontal speed error" -- but the answers
// arrive as ordinary STATUSTEXT and scroll away in a feed that also carries
// mode changes and EKF chatter. The pilot then reads a red "not ready" with
// no reason attached and starts guessing.
//
// So this keeps the reasons rather than the messages. ArduPilot repeats each
// failing check about every thirty seconds while disarmed, so the same text
// arrives over and over: entries are keyed on the reason and only the newest
// timestamp is kept, which turns a scrolling feed into a checklist that
// shortens as things are fixed.

/** A PreArm or Arm failure the vehicle reported, once per distinct reason. */
export interface PrearmFailure {
  /** The reason, with ArduPilot's own "PreArm: " prefix removed. */
  reason: string
  /** When it was last reported, so a stale one can be aged out. */
  at: number
}

/**
 * ArduPilot prefixes both kinds. "PreArm" is a check that runs continuously
 * while disarmed; "Arm" is one that only fails at the moment of the attempt.
 * Both answer the same question and both belong in the same list.
 */
const PREARM_PREFIX = /^(PreArm|Arm)\s*:\s*/i

export function isPrearmMessage(text: string): boolean {
  return PREARM_PREFIX.test(text)
}

/**
 * Distil a status feed into the current reasons.
 *
 * `now` and `staleAfterMs` are passed rather than read from the clock so the
 * behavior is testable, and because "stale" is a display decision: a reason
 * last heard two minutes ago has almost certainly been fixed, and leaving it
 * up is how a checklist becomes something people ignore.
 */
export function prearmFailures(
  texts: readonly { text: string; at: number }[],
  now: number,
  staleAfterMs = 60000,
): PrearmFailure[] {
  const byReason = new Map<string, number>()
  for (const t of texts) {
    if (!isPrearmMessage(t.text)) continue
    const reason = t.text.replace(PREARM_PREFIX, '').trim()
    if (!reason) continue
    const prev = byReason.get(reason)
    if (prev === undefined || t.at > prev) byReason.set(reason, t.at)
  }
  return [...byReason]
    .filter(([, at]) => now - at <= staleAfterMs)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, at]) => ({ reason, at }))
}
