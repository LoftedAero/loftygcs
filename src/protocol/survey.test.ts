import { describe, expect, it } from 'vitest'
import {
  pathLengthM,
  polygonAreaM2,
  surveyGrid,
  SURVEY_DEFAULTS,
  MAX_PASSES,
  type GeoPoint,
} from './survey'

// A survey is the one part of mission planning where "it looks right" is not
// good enough: a gap between passes is a strip of ground that never got
// photographed, and nobody finds out until the map is stitched.

const HOME = { lat: -35.363262, lon: 149.165237 }
const deg = (lat: number, lon: number): GeoPoint => ({
  x: Math.round(lat * 1e7),
  y: Math.round(lon * 1e7),
})

/** A square `m` meters on a side, near SITL's home. */
function square(m: number): GeoPoint[] {
  const dLat = m / 111320
  const dLon = m / (111320 * Math.cos((HOME.lat * Math.PI) / 180))
  return [
    deg(HOME.lat, HOME.lon),
    deg(HOME.lat + dLat, HOME.lon),
    deg(HOME.lat + dLat, HOME.lon + dLon),
    deg(HOME.lat, HOME.lon + dLon),
  ]
}

describe('polygonAreaM2', () => {
  it('measures a square in real square meters', () => {
    // The whole reason the geometry is done in a local projection: computed
    // in raw degrees this comes out wrong by the cosine of the latitude.
    expect(polygonAreaM2(square(200))).toBeGreaterThan(200 * 200 * 0.97)
    expect(polygonAreaM2(square(200))).toBeLessThan(200 * 200 * 1.03)
  })

  it('does not care which way the polygon is wound', () => {
    const s = square(100)
    expect(polygonAreaM2([...s].reverse())).toBeCloseTo(polygonAreaM2(s), 0)
  })

  it('is zero for anything that is not an area', () => {
    expect(polygonAreaM2([])).toBe(0)
    expect(polygonAreaM2([deg(HOME.lat, HOME.lon), deg(HOME.lat + 0.001, HOME.lon)])).toBe(0)
  })
})

describe('surveyGrid', () => {
  const opts = { ...SURVEY_DEFAULTS, spacingM: 50, overshootM: 0 }

  it('covers a square with the passes the spacing implies', () => {
    // 200 m of width at 50 m spacing: passes at 25, 75, 125 and 175 m.
    const r = surveyGrid(square(200), opts)
    expect(r.passes).toBe(4)
    expect(r.points).toHaveLength(8)
    expect(r.problem).toBeUndefined()
  })

  it('lays passes half a spacing in from the edges', () => {
    // Otherwise the first pass wastes half its swath outside the area and
    // the far edge is missed entirely.
    const r = surveyGrid(square(200), opts)
    const lats = r.points.map((p) => p.x / 1e7)
    const south = Math.min(...lats)
    const edge = HOME.lat
    const inset = (south - edge) * 111320
    expect(inset).toBeGreaterThan(20)
    expect(inset).toBeLessThan(30)
  })

  it('alternates direction so the passes join end to end', () => {
    // A grid that always ran west to east would fly the width of the area
    // empty between every pass -- double the flight time for the same photos.
    const r = surveyGrid(square(200), opts)
    const lonOf = (i: number) => r.points[i]!.y
    // Pass 1 runs one way, pass 2 comes back: the end of pass 1 and the
    // start of pass 2 are on the same side.
    expect(Math.abs(lonOf(1) - lonOf(2))).toBeLessThan(Math.abs(lonOf(0) - lonOf(1)))
  })

  it('turns the whole grid with the angle', () => {
    const straight = surveyGrid(square(200), { ...opts, angleDeg: 0 })
    const turned = surveyGrid(square(200), { ...opts, angleDeg: 90 })
    expect(turned.passes).toBeGreaterThan(0)
    // Same area and spacing, so a square gives about the same coverage
    // whichever way the passes run.
    expect(turned.lengthM).toBeGreaterThan(straight.lengthM * 0.8)
    expect(turned.lengthM).toBeLessThan(straight.lengthM * 1.2)
    // But the passes themselves point a different way.
    const runOf = (r: typeof straight) =>
      Math.abs(r.points[0]!.x - r.points[1]!.x) > Math.abs(r.points[0]!.y - r.points[1]!.y)
    expect(runOf(straight)).not.toBe(runOf(turned))
  })

  it('extends each pass by the overshoot, at both ends', () => {
    const none = surveyGrid(square(200), { ...opts, overshootM: 0 })
    const some = surveyGrid(square(200), { ...opts, overshootM: 25 })
    expect(some.passes).toBe(none.passes)
    // Every pass gains 50 m, so the path gains 50 m per pass.
    expect(some.lengthM).toBeGreaterThan(none.lengthM + 50 * none.passes * 0.9)
  })

  it('breaks a concave area into separate passes rather than cutting across', () => {
    // A U shape. A scan line through the notch crosses the boundary four
    // times, and flying straight between the second and third crossing would
    // take the aircraft over ground that is not in the survey.
    const d = 200 / 111320
    const dLon = 200 / (111320 * Math.cos((HOME.lat * Math.PI) / 180))
    const u: GeoPoint[] = [
      deg(HOME.lat, HOME.lon),
      deg(HOME.lat + d, HOME.lon),
      deg(HOME.lat + d, HOME.lon + dLon * 0.35),
      deg(HOME.lat + d * 0.35, HOME.lon + dLon * 0.35),
      deg(HOME.lat + d * 0.35, HOME.lon + dLon * 0.65),
      deg(HOME.lat + d, HOME.lon + dLon * 0.65),
      deg(HOME.lat + d, HOME.lon + dLon),
      deg(HOME.lat, HOME.lon + dLon),
    ]
    const r = surveyGrid(u, { ...opts, spacingM: 40 })
    // More passes than rows, because the upper rows are split by the notch.
    const rows = Math.floor(200 / 40)
    expect(r.passes).toBeGreaterThan(rows)
    expect(r.points.length).toBe(r.passes * 2)
  })

  it('still covers an area narrower than one pass', () => {
    // Drawing a thin strip and being told nothing fits would be technically
    // true and useless; one pass down the middle is what was meant.
    const thin = [
      deg(HOME.lat, HOME.lon),
      deg(HOME.lat + 10 / 111320, HOME.lon),
      deg(HOME.lat + 10 / 111320, HOME.lon + 200 / (111320 * Math.cos((HOME.lat * Math.PI) / 180))),
      deg(HOME.lat, HOME.lon + 200 / (111320 * Math.cos((HOME.lat * Math.PI) / 180))),
    ]
    const r = surveyGrid(thin, { ...opts, spacingM: 50 })
    expect(r.passes).toBe(1)
    expect(r.problem).toBeUndefined()
  })

  it('refuses what it cannot survey, and says why', () => {
    expect(surveyGrid([], opts).problem).toMatch(/three corners/)
    expect(surveyGrid(square(200), { ...opts, spacingM: 0 }).problem).toMatch(/greater than zero/)
    const dot = [deg(HOME.lat, HOME.lon), deg(HOME.lat, HOME.lon), deg(HOME.lat, HOME.lon)]
    expect(surveyGrid(dot, opts).problem).toMatch(/too small/)
  })

  it('reports a length that matches the path it returned', () => {
    const r = surveyGrid(square(300), opts)
    expect(r.lengthM).toBeCloseTo(pathLengthM(r.points), 0)
    // Sanity: covering 300 m at 50 m spacing is 6 passes of 300 m plus the
    // turns, so a few kilometers rather than a few hundred meters.
    expect(r.lengthM).toBeGreaterThan(1800)
    expect(r.lengthM).toBeLessThan(4000)
  })
})

describe('guards against an unflyable grid', () => {
  it('refuses a huge area at a fine spacing instead of computing it', () => {
    // A degree of latitude at 40 m spacing is nearly 3,000 passes -- the
    // shape a user gets by drawing on a zoomed-out map, which used to lock
    // the window while it generated.
    const huge: GeoPoint[] = [
      { x: 390000000, y: -1190000000 },
      { x: 400000000, y: -1190000000 },
      { x: 400000000, y: -1189000000 },
      { x: 390000000, y: -1189000000 },
    ]
    const r = surveyGrid(huge, { ...SURVEY_DEFAULTS, spacingM: 40 })
    expect(r.points).toHaveLength(0)
    expect(r.problem).toMatch(/passes/)
  })

  it('accepts the same area once the spacing is wide enough', () => {
    const huge: GeoPoint[] = [
      { x: 390000000, y: -1190000000 },
      { x: 400000000, y: -1190000000 },
      { x: 400000000, y: -1189000000 },
      { x: 390000000, y: -1189000000 },
    ]
    const r = surveyGrid(huge, { ...SURVEY_DEFAULTS, spacingM: 5000 })
    expect(r.problem).toBeUndefined()
    expect(r.passes).toBeGreaterThan(10)
    expect(r.passes).toBeLessThanOrEqual(MAX_PASSES)
  })
})
