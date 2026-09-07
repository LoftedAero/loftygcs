import { create } from 'zustand'
import {
  bearingDeg,
  distanceM,
  EMITTER_LABELS,
  targetLabel,
  type AdsbTarget,
} from '../protocol/adsb'

// Re-exported rather than imported from `protocol/` by the screens: the
// layering rule (see CLAUDE.md, and eslint's no-restricted-paths) keeps the
// UI reaching the protocol only through the stores, and a traffic marker
// needs the same name and emitter word the list uses.
export { EMITTER_LABELS, targetLabel }
export type { AdsbTarget }

// The aircraft around this one, as the flight screen sees them.
//
// A plain snapshot store rather than a ring buffer or a per-target
// subscription: ADS-B updates about once a second per aircraft and the
// engine already batches a whole picture at that rate, so one store write a
// second moves every marker on the map. That is nothing like the attitude
// stream this codebase keeps out of React, and treating it the same way
// would be machinery for a problem that is not here.
//
// Nothing in this file decides anything about flying. ArduPilot runs its own
// avoidance from the same reports (the AVD_* parameters); this is the picture
// beside the map, and the distances below are for reading, not for acting.

export interface TrafficState {
  /** Everything currently heard, newest picture wins. */
  targets: AdsbTarget[]
  /** Whether any report has ever arrived on this connection. */
  everSeen: boolean
  applyTargets(targets: AdsbTarget[]): void
  clear(): void
}

export const useTrafficStore = create<TrafficState>((set) => ({
  targets: [],
  everSeen: false,
  applyTargets(targets) {
    set((s) => ({ targets, everSeen: s.everSeen || targets.length > 0 }))
  },
  clear() {
    set({ targets: [], everSeen: false })
  },
}))

/**
 * What counts as worth looking at first, on the map and in the list.
 *
 * A display threshold, not a collision test: it decides what the eye is
 * drawn to, and ArduPilot's own avoidance (the AVD_* parameters) is what
 * decides anything else.
 */
const CLOSE_RANGE_M = 2000
const CLOSE_ALT_M = 300

/**
 * Whether a contact should stand out.
 *
 * An unknown altitude counts as close when the range is close, rather than
 * as not-close. The first version required a known relative height, which
 * quietly made the least-known aircraft the least visible -- a contact at
 * 900 m whose altitude nobody reported was drawn calmer than one at 1.5 km
 * with a comfortable 200 m of separation. Unknown is not clear.
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
  /**
   * Meters above this vehicle, positive up -- the number that decides
   * whether a contact matters, and null unless both altitudes are known.
   */
  relAltM: number | null
  /**
   * Whether this vehicle knew where it was, and so whether the three fields
   * above mean anything. Carried explicitly rather than inferred from a null
   * range: both screens need to tell "no fix here" from "this report had no
   * altitude", and those are different sentences to put on a screen.
   */
  relative: boolean
}

/**
 * Traffic as it stands from here: how far, which way, how far above.
 *
 * Both altitudes are AMSL, which is the one place the two sources agree.
 * A transponder reports pressure altitude against the standard datum and the
 * vehicle reports its own AMSL from GPS, so the difference is only ever
 * approximate -- good to a few hundred feet in the same air mass, which is
 * the resolution the number is read at anyway. Anyone treating it as exact
 * separation is using it for something it cannot do.
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
  // Nearest first: on a traffic list the top of the screen is where the
  // thing you care about belongs, and the thing you care about is the close
  // one. Targets with no range at all sort last rather than first, which is
  // where a sort on null would have put them.
  return out.sort((a, b) => (a.rangeM ?? Infinity) - (b.rangeM ?? Infinity))
}
