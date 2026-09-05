import { commandSpec } from '../protocol/mission-commands'
import { distanceM, hasCoords, type MissionPlan } from '../protocol/mission-plan'
import { groundLevel, sampleElevation, type LatLon, type TerrainGrids } from './terrain-math'

// A mission seen against the ground it flies over.
//
// The arithmetic that matters is the datum. ArduPilot carries three
// altitude frames and a profile has to draw them on one axis: 3 is meters
// above *home*, 0 is above mean sea level, and 10 is above the terrain
// directly below the waypoint. Mixing them up is not a cosmetic bug -- a
// mission that clears a ridge in one frame flies into it in another -- so
// everything here is converted to AMSL first and the drawing subtracts the
// home elevation at the end.
//
// Clearance is checked *between* waypoints, not at them. Two waypoints at
// 100 m with a 140 m hill between them are both individually fine, and
// that is exactly the mission this is here to catch.

/** Enough to resolve a hill between waypoints without resampling forever. */
export const PROFILE_SAMPLES = 200

export interface RouteSample extends LatLon {
  /** Ground distance from the start of the route, meters. */
  d: number
}

const toLatLon = (it: { x: number; y: number }): LatLon => ({ lat: it.x / 1e7, lon: it.y / 1e7 })

/** The flown ground track: home, then every item that carries a position. */
export function routeCorners(plan: MissionPlan): RouteSample[] {
  const out: RouteSample[] = []
  let prev: { x: number; y: number } | null = null
  let total = 0
  const push = (p: { x: number; y: number }) => {
    if (prev) total += distanceM(prev, p)
    out.push({ ...toLatLon(p), d: total })
    prev = p
  }
  if (plan.home) push(plan.home)
  for (const it of plan.items) if (hasCoords(it)) push(it)
  return out
}

/**
 * Evenly spaced points along the track.
 *
 * Interpolated linearly in latitude and longitude rather than along a great
 * circle: a mission leg is kilometers, where the two differ by centimeters,
 * and the sample only has to land in the right 38 m terrain pixel.
 */
export function routeSamples(plan: MissionPlan, count = PROFILE_SAMPLES): RouteSample[] {
  const corners = routeCorners(plan)
  if (corners.length === 0) return []
  const last = corners[corners.length - 1]!
  if (corners.length === 1 || last.d === 0) return [corners[0]!]
  const out: RouteSample[] = []
  let leg = 0
  for (let i = 0; i < count; i++) {
    const d = (last.d * i) / (count - 1)
    while (leg < corners.length - 2 && corners[leg + 1]!.d < d) leg++
    const a = corners[leg]!
    const b = corners[leg + 1]!
    const span = b.d - a.d
    const t = span > 0 ? (d - a.d) / span : 0
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, d })
  }
  return out
}

export interface GroundPoint {
  d: number
  /** Meters above mean sea level, sea floor pulled up to zero. */
  amslM: number
}

/** Ground under the route, or null where the terrain tile is missing. */
export function groundProfile(samples: readonly RouteSample[], grids: TerrainGrids): GroundPoint[] {
  const out: GroundPoint[] = []
  for (const s of samples) {
    const raw = sampleElevation(grids, s)
    if (raw !== null) out.push({ d: s.d, amslM: groundLevel(raw) })
  }
  return out
}

export interface HomeElevation {
  /** Meters above mean sea level that a relative altitude of zero means. */
  amslM: number
  source: 'plan' | 'terrain' | 'route' | 'none'
}

/**
 * What "zero relative altitude" is worth in meters above the sea.
 *
 * The vehicle's own home elevation wins when there is one: it is surveyed
 * by the GPS at arming, where the terrain data is a 38 m sample of a public
 * dataset. Terrain under home fills in for a plan drawn before connecting.
 *
 * With no home at all -- a mission sketched at the kitchen table, where
 * home is wherever the vehicle ends up on the day -- the ground under the
 * first waypoint stands in, because that is within a few meters of where
 * home will be and because the alternative is a profile that draws nothing
 * on exactly the evening someone is checking a route over a ridge.
 */
export function homeElevation(plan: MissionPlan, grids: TerrainGrids): HomeElevation {
  // A plan loaded from a file, or a home dropped on the map, carries zero
  // here; the vehicle's own home never does, so zero means "not surveyed".
  if (plan.home && plan.home.z !== 0) return { amslM: plan.home.z, source: 'plan' }
  if (plan.home) {
    const raw = sampleElevation(grids, toLatLon(plan.home))
    if (raw !== null) return { amslM: groundLevel(raw), source: 'terrain' }
    return { amslM: 0, source: 'none' }
  }
  const first = plan.items.find(hasCoords)
  if (first) {
    const raw = sampleElevation(grids, toLatLon(first))
    if (raw !== null) return { amslM: groundLevel(raw), source: 'route' }
  }
  return { amslM: 0, source: 'none' }
}

export interface ItemAltitude {
  uid: string
  /** Meters above mean sea level. */
  amslM: number
  d: number
}

/**
 * Every altitude-bearing item, in one frame.
 *
 * `homeAmslM` is what a relative altitude of zero means. It is the vehicle's
 * home elevation when there is one and the terrain under home otherwise --
 * a plan drawn before connecting has no surveyed home, and refusing to
 * draw a profile until one exists would make the feature useless in the
 * one place it is most wanted, at the kitchen table the night before.
 */
export function itemAltitudes(
  plan: MissionPlan,
  homeAmslM: number,
  grids: TerrainGrids,
): ItemAltitude[] {
  const corners = routeCorners(plan)
  // routeCorners starts at home when there is one, so located items line up
  // with the tail of that list.
  let ci = plan.home ? 1 : 0
  let lastD = corners[0]?.d ?? 0
  const out: ItemAltitude[] = []
  for (const it of plan.items) {
    const located = hasCoords(it)
    const d = located ? (corners[ci]?.d ?? lastD) : lastD
    if (located) {
      ci++
      lastD = d
    }
    if (commandSpec(it.command)?.altitude === false) continue
    let amslM: number
    if (it.frame === 0) amslM = it.z
    else if (it.frame === 10) {
      const raw = located ? sampleElevation(grids, toLatLon(it)) : null
      // No terrain under a terrain-frame waypoint: the honest fallback is
      // home's ground, which is what ArduPilot itself falls back to when
      // it has no terrain data for a point.
      amslM = (raw === null ? homeAmslM : groundLevel(raw)) + it.z
    } else amslM = homeAmslM + it.z
    out.push({ uid: it.uid, amslM, d })
  }
  return out
}

/** The flown altitude at a distance along the route, AMSL. */
export function altitudeAt(items: readonly ItemAltitude[], d: number): number | null {
  if (items.length === 0) return null
  const first = items[0]!
  const last = items[items.length - 1]!
  if (d <= first.d) return first.amslM
  if (d >= last.d) return last.amslM
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i]!
    const b = items[i + 1]!
    if (d >= a.d && d <= b.d) {
      const span = b.d - a.d
      return span > 0 ? a.amslM + ((b.amslM - a.amslM) * (d - a.d)) / span : b.amslM
    }
  }
  return last.amslM
}

export interface Clearance {
  /** Least height above ground anywhere along the route, meters. */
  minM: number
  /** Where that happens, meters along the route. */
  atD: number
  /** The leg it happens on, as the uids of the items either side. */
  from: string | null
  to: string | null
}

/**
 * The tightest the mission comes to the ground.
 *
 * Only over the stretch the profile actually draws -- from the first
 * altitude-bearing item to the last. Before the first one the vehicle is
 * climbing out and after the last it is landing or looping, neither of
 * which this can say anything useful about.
 */
export function minClearance(
  ground: readonly GroundPoint[],
  items: readonly ItemAltitude[],
): Clearance | null {
  if (items.length === 0) return null
  const from = items[0]!.d
  const to = items[items.length - 1]!.d
  let best: Clearance | null = null
  for (const g of ground) {
    if (g.d < from || g.d > to) continue
    const alt = altitudeAt(items, g.d)
    if (alt === null) continue
    const clearance = alt - g.amslM
    if (!best || clearance < best.minM) best = { minM: clearance, atD: g.d, ...legAt(items, g.d) }
  }
  return best
}

/**
 * Which two items a point on the route falls between.
 *
 * "Between 3 and 4" is what a planner can act on; the same place given as
 * 17,375 m along the route has to be counted out on the map first.
 */
function legAt(
  items: readonly ItemAltitude[],
  d: number,
): { from: string | null; to: string | null } {
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i]!
    const b = items[i + 1]!
    if (d >= a.d && d <= b.d) return { from: a.uid, to: b.uid }
  }
  const only = items[0]
  return { from: only?.uid ?? null, to: null }
}
