import { create } from 'zustand'
import {
  bearingDeg,
  distanceM,
  EMITTER_LABELS,
  targetLabel,
  type AdsbTarget,
} from '../protocol/adsb'

// Re-exported because the UI may reach the protocol only through the stores
// (eslint's no-restricted-paths).
export { EMITTER_LABELS, targetLabel }
export type { AdsbTarget }

// The aircraft around this one, as the flight screen sees them.
//
// A plain snapshot store: the engine flushes the whole picture about once a
// second, so one store write per second moves every marker. Nothing here
// decides anything about flying; ArduPilot runs its own avoidance from the
// same reports (the AVD_* parameters).

export interface TrafficState {
  /** Everything currently heard, newest picture wins. */
  targets: AdsbTarget[]
  applyTargets(targets: AdsbTarget[]): void
  clear(): void
}

export const useTrafficStore = create<TrafficState>((set) => ({
  targets: [],
  applyTargets(targets) {
    set({ targets })
  },
  clear() {
    set({ targets: [] })
  },
}))

/** Display thresholds for what stands out, not a collision test. */
const CLOSE_RANGE_M = 2000
const CLOSE_ALT_M = 300

/**
 * Whether a contact should stand out. An unknown altitude counts as close
 * when the range is close: unknown is not clear.
 */
export function isClose(t: RelativeTarget): boolean {
  if (t.rangeM === null || t.rangeM > CLOSE_RANGE_M) return false
  return t.relAltM === null || Math.abs(t.relAltM) < CLOSE_ALT_M
}

export interface RelativeTarget extends AdsbTarget {
  /** Meters from this vehicle, or null before it has a fix of its own. */
  rangeM: number | null
  /** True bearing from this vehicle to it, or null without a fix. */
  bearingDeg: number | null
  /** Meters above this vehicle, positive up; null unless both altitudes are known. */
  relAltM: number | null
  /**
   * Whether this vehicle had a fix, so the fields above are meaningful.
   * Explicit rather than inferred from a null range, so "no fix here" can be
   * told apart from "this report had no altitude".
   */
  relative: boolean
}

/**
 * Traffic relative to this vehicle: range, bearing and height difference.
 *
 * Both altitudes are AMSL, but a transponder reports pressure altitude while
 * the vehicle reports GPS altitude, so the difference is approximate (a few
 * hundred feet in the same air mass).
 */
export function relativeTo(
  targets: readonly AdsbTarget[],
  own: { latDeg: number; lonDeg: number; altMslM: number } | null,
): RelativeTarget[] {
  const out = targets.map((t) => ({
    ...t,
    rangeM: own ? distanceM(own, t) : null,
    bearingDeg: own ? bearingDeg(own, t) : null,
    relAltM: own && t.altMslM !== null ? t.altMslM - own.altMslM : null,
    relative: own !== null,
  }))
  // Nearest first; targets with no range sort last.
  return out.sort((a, b) => (a.rangeM ?? Infinity) - (b.rangeM ?? Infinity))
}
