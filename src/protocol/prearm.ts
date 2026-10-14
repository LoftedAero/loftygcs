// Why the vehicle will not arm.
//
// ArduPilot reports each failing check as STATUSTEXT ("PreArm: Compass not
// calibrated"), mixed in with everything else. It repeats each one about
// every thirty seconds while disarmed, so entries are keyed on the reason and
// keep only the newest timestamp, giving a checklist that shortens as things
// are fixed.

/** A PreArm or Arm failure the vehicle reported, once per distinct reason. */
export interface PrearmFailure {
  /** The reason, with ArduPilot's own "PreArm: " prefix removed. */
  reason: string
  /** When it was last reported, so a stale one can be aged out. */
  at: number
}

/**
 * "PreArm" checks run continuously while disarmed; "Arm" checks fail only at
 * the moment of an attempt. Both go in the same list.
 */
const PREARM_PREFIX = /^(PreArm|Arm)\s*:\s*/i

export function isPrearmMessage(text: string): boolean {
  return PREARM_PREFIX.test(text)
}

/**
 * Distill a status feed into the current reasons. A reason not repeated
 * within `staleAfterMs` has almost certainly been fixed and is dropped.
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

const ARM_PREFIX = /^Arm\s*:/i

/**
 * The reasons that still explain something, given the vehicle's own verdict.
 * Once its prearm checks pass, a PreArm reason is out of date even though it
 * is within the minute (they repeat only every thirty seconds); an Arm reason
 * is a refused attempt the verdict says nothing about. An armed vehicle has
 * nothing left to explain, and with no verdict reported every reason stands.
 */
export function currentFailures(
  texts: readonly { text: string; at: number }[],
  now: number,
  readiness: 'armed' | 'ready' | 'notReady' | 'unknown',
): PrearmFailure[] {
  if (readiness === 'armed') return []
  const standing = readiness === 'ready' ? texts.filter((t) => ARM_PREFIX.test(t.text)) : texts
  return prearmFailures(standing, now)
}
