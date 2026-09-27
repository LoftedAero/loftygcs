import { commandSpec } from '../protocol/mission-commands'
import { distanceM, hasCoords, type MissionPlan } from '../protocol/mission-plan'
import { groundLevel, sampleElevation, type LatLon, type TerrainGrids } from './terrain-math'

// A mission seen against the ground it flies over.
//
// ArduPilot has three altitude frames: 3 is meters above home, 0 is above
// mean sea level, and 10 is above the terrain below the waypoint. Everything
// here is converted to AMSL first; the drawing subtracts home elevation at
// the end.
//
// Clearance is checked between waypoints, not only at them: two waypoints at
// 100 m with a 140 m hill between them are each fine on their own.

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
 * Evenly spaced points along the track, interpolated linearly in lat/lon.
 * Over a mission leg that differs from a great circle by centimeters, well
 * inside a 38 m terrain pixel.
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
 * What zero relative altitude means in meters AMSL.
 *
 * The vehicle's own home elevation (surveyed by GPS) wins when there is one;
 * otherwise the terrain under home. With no home at all, the ground under the
 * first waypoint stands in, since home is usually close to it.
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
 * Every altitude-bearing item, converted to AMSL. `homeAmslM` is what a
 * relative altitude of zero means (see `homeElevation`).
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
      // No terrain under a terrain-frame waypoint: fall back to home's
      // ground, as ArduPilot does when it has no terrain data for a point.
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

export interface LegSlope {
  /** Climb angle from the previous item, degrees. Negative is descending. */
  deg: number
  /** The same as a percentage: 100 m of climb over 1 km is 10%. */
  percent: number
}

/**
 * How steeply each leg climbs or descends, by item uid, for planning landing
 * approaches. Computed from AMSL altitudes so mixed frames are handled.
 * Omitted for the first item, items with no altitude, and legs with no
 * horizontal distance (a vertical climb has no gradient).
 */
export function legSlopes(items: readonly ItemAltitude[]): Map<string, LegSlope> {
  const out = new Map<string, LegSlope>()
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!
    const b = items[i]!
    const run = b.d - a.d
    if (run <= 0) continue
    const rise = b.amslM - a.amslM
    out.set(b.uid, {
      deg: (Math.atan2(rise, run) * 180) / Math.PI,
      percent: (rise / run) * 100,
    })
  }
  return out
}

/** Commands that end on the ground, whatever altitude the item carries. */
const LANDINGS = new Set([21, 85])

/**
 * Leg slopes for the whole route, including the descent onto a landing.
 *
 * `itemAltitudes` leaves landings out because ArduPilot ignores their
 * altitude. For slopes they are put back at ground level, but only here: the
 * clearance check would otherwise flag every landing as flying into terrain.
 */
export function approachSlopes(
  plan: MissionPlan,
  homeAmslM: number,
  grids: TerrainGrids,
): Map<string, LegSlope> {
  const corners = routeCorners(plan)
  let ci = plan.home ? 1 : 0
  const landings: ItemAltitude[] = []
  for (const it of plan.items) {
    const located = hasCoords(it)
    const d = located ? (corners[ci]?.d ?? 0) : null
    if (located) ci++
    if (d === null || !LANDINGS.has(it.command)) continue
    const raw = sampleElevation(grids, toLatLon(it))
    landings.push({ uid: it.uid, amslM: raw === null ? homeAmslM : groundLevel(raw), d })
  }
  const all = [...itemAltitudes(plan, homeAmslM, grids), ...landings].sort((a, b) => a.d - b.d)
  return legSlopes(all)
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
 * The tightest the mission comes to the ground, between the first and last
 * altitude-bearing items. Outside that the vehicle is climbing out or
 * landing, which this cannot judge.
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

/** Which two items a point on the route falls between. */
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
