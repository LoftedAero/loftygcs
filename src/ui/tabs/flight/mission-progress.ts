// What to say about mission progress, separated from how it is drawn.
//
// The arithmetic is small but every part of it has a wrong answer that looks
// plausible on screen, which is what makes it worth testing rather than
// inlining: an ETA computed from a groundspeed of zero is Infinity, one
// computed while hovering over the waypoint is a flicker between 0 and 3
// seconds, and a sequence number from a plan this GCS has never seen indexes
// past the end of the array.

import type { PlanItem } from '../../../protocol/mission-plan'
import { commandSpec } from '../../../protocol/mission-commands'

/** Below this the vehicle is not making progress and an ETA is noise. */
const MIN_GROUNDSPEED_MS = 0.5
/** Past an hour, a number of minutes stops being a useful thing to read. */
const MAX_ETA_S = 3600

export interface MissionProgress {
  /** "3 of 12", or null when the vehicle has not said where it is. */
  position: string | null
  /** The command being flown, named, when the plan aboard is known here. */
  commandName: string | null
  /** Seconds to the current waypoint, or null when that cannot be known. */
  etaS: number | null
}

export function missionProgress(
  seq: number | null,
  items: readonly PlanItem[],
  wpDistM: number | null,
  groundspeedMs: number,
): MissionProgress {
  if (seq === null) return { position: null, commandName: null, etaS: null }

  // The vehicle's plan and this GCS's plan can differ -- a plan uploaded
  // elsewhere, or none loaded here at all. The sequence number is still
  // true, so it is shown; only the parts that need the local plan drop out.
  const known = seq >= 0 && seq < items.length
  const total = items.length
  const position = total > 0 ? `${seq} of ${total - 1}` : String(seq)
  const commandName = known ? (commandSpec(items[seq]!.command)?.name ?? null) : null

  let etaS: number | null = null
  if (wpDistM !== null && groundspeedMs >= MIN_GROUNDSPEED_MS) {
    const t = wpDistM / groundspeedMs
    if (t <= MAX_ETA_S) etaS = t
  }
  return { position, commandName, etaS }
}

/** Seconds as a clock a pilot reads at a glance: 0:45, 3:20. */
export function formatEta(seconds: number): string {
  const whole = Math.round(seconds)
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
