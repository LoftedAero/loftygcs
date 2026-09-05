import { describe, expect, it } from 'vitest'
import type { MissionPlan, PlanItem } from '../protocol/mission-plan'
import { TERRAIN_TILE_PX, TERRAIN_ZOOM, terrainTilesFor, type TerrainGrids } from './terrain-math'
import {
  altitudeAt,
  groundProfile,
  homeElevation,
  itemAltitudes,
  minClearance,
  routeCorners,
  routeSamples,
} from './mission-terrain'

// The field these coordinates sit in is CMAC, whose real elevation is 584 m
// -- the same place the SITL default home uses, so the numbers here are the
// ones a bench test against SITL would produce.

const HOME = { x: -353632621, y: 1491652374, z: 584 }

const item = (over: Partial<PlanItem>, i: number): PlanItem => ({
  uid: `u${i}`,
  frame: 3,
  command: 16,
  autocontinue: 1,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
  x: HOME.x,
  y: HOME.y,
  z: 50,
  ...over,
})

const plan = (items: Partial<PlanItem>[], home: MissionPlan['home'] = HOME): MissionPlan => ({
  home,
  items: items.map(item),
})

/**
 * Synthetic ground at the real terrain zoom, so the code under test does
 * its own tile lookup rather than being handed a grid that happens to fit.
 */
function terrainWhere(metersAt: (lon: number) => number): TerrainGrids {
  const z = TERRAIN_ZOOM
  const span = 2 ** z * TERRAIN_TILE_PX
  const points = [
    { lat: HOME.x / 1e7, lon: HOME.y / 1e7 },
    { lat: (HOME.x + 100000) / 1e7, lon: (HOME.y + 200000) / 1e7 },
    { lat: (HOME.x + 100000) / 1e7, lon: HOME.y / 1e7 },
  ]
  const grids = new Map<string, Float32Array>()
  for (const t of terrainTilesFor(points, z)) {
    const grid = new Float32Array(TERRAIN_TILE_PX * TERRAIN_TILE_PX)
    for (let iy = 0; iy < TERRAIN_TILE_PX; iy++) {
      for (let ix = 0; ix < TERRAIN_TILE_PX; ix++) {
        const lon = ((t.x * TERRAIN_TILE_PX + ix + 0.5) / span) * 360 - 180
        grid[iy * TERRAIN_TILE_PX + ix] = metersAt(lon)
      }
    }
    grids.set(`${z}/${t.x}/${t.y}`, grid)
  }
  return grids
}

const flat = (m: number): TerrainGrids => terrainWhere(() => m)

describe('the ground track', () => {
  it('starts at home and skips items with no position', () => {
    const p = plan([
      { x: 0, y: 0, command: 22 },
      { x: HOME.x + 10000, y: HOME.y },
    ])
    const corners = routeCorners(p)
    expect(corners).toHaveLength(2)
    expect(corners[0]!.d).toBe(0)
    expect(corners[1]!.d).toBeGreaterThan(0)
  })

  it('samples evenly along the whole route', () => {
    const p = plan([{ x: HOME.x + 100000, y: HOME.y }, { x: HOME.x + 100000, y: HOME.y + 100000 }])
    const samples = routeSamples(p, 50)
    expect(samples).toHaveLength(50)
    expect(samples[0]!.d).toBe(0)
    const total = routeCorners(p).at(-1)!.d
    expect(samples.at(-1)!.d).toBeCloseTo(total, 6)
    const step = samples[1]!.d - samples[0]!.d
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.d - samples[i - 1]!.d).toBeCloseTo(step, 6)
    }
  })

  it('bends where the route bends', () => {
    // A sample halfway along an L-shaped route is on the second leg, not on
    // the straight line between the ends.
    const p = plan([{ x: HOME.x + 100000, y: HOME.y }, { x: HOME.x + 100000, y: HOME.y + 100000 }])
    const mid = routeSamples(p, 101)[75]!
    expect(mid.lat).toBeCloseTo((HOME.x + 100000) / 1e7, 5)
  })

  it('has nothing to say about a plan with one point', () => {
    expect(routeSamples(plan([]), 20)).toHaveLength(1)
    expect(routeSamples({ home: null, items: [] }, 20)).toHaveLength(0)
  })
})

describe('putting the frames on one axis', () => {
  const grids = flat(600)

  it('reads a relative altitude against home', () => {
    const [a] = itemAltitudes(plan([{ frame: 3, z: 50 }]), 584, grids)
    expect(a!.amslM).toBe(634)
  })

  it('takes an absolute altitude as it stands', () => {
    const [a] = itemAltitudes(plan([{ frame: 0, z: 634 }]), 584, grids)
    expect(a!.amslM).toBe(634)
  })

  it('reads a terrain altitude against the ground under that waypoint', () => {
    // Home is 584 but the ground here is 600: a terrain-frame 50 m is 650,
    // not 634. Getting this wrong is the bug that flies into the ridge.
    const [a] = itemAltitudes(plan([{ frame: 10, z: 50 }]), 584, grids)
    expect(a!.amslM).toBeCloseTo(650, 3)
  })

  it('falls back to home ground where terrain is missing', () => {
    const [a] = itemAltitudes(plan([{ frame: 10, z: 50 }]), 584, new Map())
    expect(a!.amslM).toBe(634)
  })

  it('leaves out items that carry no altitude', () => {
    // DO_SET_SERVO has no height; inventing one draws a mission that does
    // not exist.
    const alts = itemAltitudes(plan([{ command: 183, x: 0, y: 0 }, { z: 50 }]), 584, grids)
    expect(alts).toHaveLength(1)
  })
})

describe('clearance', () => {
  it('finds a hill between two waypoints, not just at them', () => {
    // Both waypoints are 100 m over 584 m ground. Halfway along, the ground
    // rises to 700 -- so the leg has 16 m of clearance where each end has
    // 100. A check that only looked at waypoints would call this fine.
    const p = plan([
      { x: HOME.x, y: HOME.y, z: 100 },
      { x: HOME.x, y: HOME.y + 200000, z: 100 },
    ])
    const west = HOME.y / 1e7
    const east = (HOME.y + 200000) / 1e7
    const grids = terrainWhere((lon) => {
      const t = (lon - west) / (east - west)
      return t > 0.4 && t < 0.6 ? 700 : 584
    })
    const items = itemAltitudes(p, 584, grids)
    const ground = groundProfile(routeSamples(p, 200), grids)
    const worst = minClearance(ground, items)
    expect(worst).not.toBeNull()
    expect(worst!.minM).toBeCloseTo(-16, 0)
    // Named by the leg it is on: "between 1 and 2" is actionable where
    // "17,375 m along the route" has to be counted out on the map.
    expect(worst!.from).toBe('u0')
    expect(worst!.to).toBe('u1')
  })

  it('is the plain difference over flat ground', () => {
    const p = plan([
      { x: HOME.x, y: HOME.y, z: 100 },
      { x: HOME.x + 50000, y: HOME.y, z: 100 },
    ])
    const grids = flat(584)
    const worst = minClearance(groundProfile(routeSamples(p, 50), grids), itemAltitudes(p, 584, grids))
    expect(worst!.minM).toBeCloseTo(100, 6)
  })

  it('says nothing rather than guessing when there is no terrain', () => {
    const p = plan([{ z: 100 }])
    expect(minClearance(groundProfile(routeSamples(p, 10), new Map()), itemAltitudes(p, 584, new Map()))).toBeNull()
  })
})

describe('the flown altitude between waypoints', () => {
  const items = [
    { uid: 'a', amslM: 600, d: 0 },
    { uid: 'b', amslM: 700, d: 100 },
  ]

  it('interpolates along the leg', () => {
    expect(altitudeAt(items, 50)).toBe(650)
    expect(altitudeAt(items, 25)).toBe(625)
  })

  it('holds the end values beyond the ends', () => {
    expect(altitudeAt(items, -10)).toBe(600)
    expect(altitudeAt(items, 999)).toBe(700)
  })

  it('has no answer with no items', () => {
    expect(altitudeAt([], 10)).toBeNull()
  })
})

describe('what zero relative altitude means', () => {
  it('trusts the vehicle home over the terrain sample', () => {
    // Home is surveyed by GPS; the terrain here is a 38 m sample of a
    // public dataset, and it reads 600 rather than 584.
    expect(homeElevation(plan([], HOME), flat(600))).toEqual({ amslM: 584, source: 'plan' })
  })

  it('falls back to terrain for a plan drawn before connecting', () => {
    const p = plan([], { x: HOME.x, y: HOME.y, z: 0 })
    expect(homeElevation(p, flat(600))).toEqual({ amslM: 600, source: 'terrain' })
  })

  it('stands the first waypoint in for a home nobody has placed', () => {
    // The evening-before case: a route sketched on the map with no vehicle
    // anywhere near it still gets a ground line.
    const p = plan([{ x: HOME.x, y: HOME.y, z: 50 }], null)
    expect(homeElevation(p, flat(600))).toEqual({ amslM: 600, source: 'route' })
  })

  it('says so when it has neither', () => {
    expect(homeElevation(plan([], null), new Map())).toEqual({ amslM: 0, source: 'none' })
    expect(homeElevation(plan([], { x: HOME.x, y: HOME.y, z: 0 }), new Map()).source).toBe('none')
    expect(homeElevation(plan([{ x: 0, y: 0 }], null), flat(600)).source).toBe('none')
  })
})
