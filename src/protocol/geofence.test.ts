import { describe, it, expect } from 'vitest'
import {
  FENCE_CMD,
  RALLY_CMD,
  containsPoint,
  distanceM,
  fenceFromItems,
  fenceToItems,
  rallyFromItems,
  rallyToItems,
  validateFence,
  type FencePlan,
  type FenceShape,
} from './geofence'
import type { MissionItem } from './types'

// A small square around a point in Nevada, in degrees * 1e7.
const SQUARE = [
  { x: 391000000, y: -1191000000 },
  { x: 391000000, y: -1190990000 },
  { x: 390990000, y: -1190990000 },
  { x: 390990000, y: -1191000000 },
]

function poly(inclusive: boolean, points = SQUARE): FenceShape {
  return { uid: 'p', kind: 'polygon', inclusive, points: points.map((p) => ({ ...p })) }
}

function item(over: Partial<MissionItem> & { command: number }): MissionItem {
  return {
    seq: 0,
    frame: 0,
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: 0,
    y: 0,
    z: 0,
    ...over,
  }
}

describe('fence wire round trip', () => {
  it('carries the vertex count on every vertex', () => {
    const items = fenceToItems({ shapes: [poly(true)], returnPoint: null })
    expect(items).toHaveLength(4)
    expect(items.every((i) => i.command === FENCE_CMD.inclusionVertex)).toBe(true)
    // Every vertex repeats the total -- this is the only thing that tells a
    // reader where one polygon ends and the next begins.
    expect(items.map((i) => i.param1)).toEqual([4, 4, 4, 4])
    expect(items.map((i) => i.seq)).toEqual([0, 1, 2, 3])
  })

  it('round trips two adjacent polygons without merging them', () => {
    const shifted = SQUARE.map((p) => ({ x: p.x + 200000, y: p.y }))
    const plan: FencePlan = { shapes: [poly(true), poly(false, shifted)], returnPoint: null }
    const { plan: back, problems } = fenceFromItems(fenceToItems(plan))
    expect(problems).toEqual([])
    expect(back.shapes).toHaveLength(2)
    expect(back.shapes[0]!.inclusive).toBe(true)
    expect(back.shapes[1]!.inclusive).toBe(false)
    expect(back.shapes[1]!.kind === 'polygon' && back.shapes[1]!.points).toHaveLength(4)
  })

  it('separates two polygons of the same kind and size', () => {
    // The hard case: same command, same vertex count, back to back. Only the
    // running count distinguishes them.
    const shifted = SQUARE.map((p) => ({ x: p.x + 200000, y: p.y }))
    const plan: FencePlan = { shapes: [poly(true), poly(true, shifted)], returnPoint: null }
    const { plan: back } = fenceFromItems(fenceToItems(plan))
    expect(back.shapes).toHaveLength(2)
    expect(back.shapes[0]!.kind === 'polygon' && back.shapes[0]!.points[0]!.x).toBe(391000000)
    expect(back.shapes[1]!.kind === 'polygon' && back.shapes[1]!.points[0]!.x).toBe(391200000)
  })

  it('round trips circles and the return point', () => {
    const plan: FencePlan = {
      shapes: [
        { uid: 'c', kind: 'circle', inclusive: true, center: SQUARE[0]!, radiusM: 300 },
        { uid: 'd', kind: 'circle', inclusive: false, center: SQUARE[2]!, radiusM: 50 },
      ],
      returnPoint: { x: 390995000, y: -1190995000 },
    }
    const items = fenceToItems(plan)
    expect(items.map((i) => i.command)).toEqual([
      FENCE_CMD.inclusionCircle,
      FENCE_CMD.exclusionCircle,
      FENCE_CMD.returnPoint,
    ])
    const { plan: back, problems } = fenceFromItems(items)
    expect(problems).toEqual([])
    expect(back.returnPoint).toEqual(plan.returnPoint)
    expect(back.shapes[0]!.kind === 'circle' && back.shapes[0]!.radiusM).toBe(300)
  })

  it('reports a truncated polygon rather than dropping it silently', () => {
    // Four vertices declared, two delivered.
    const items = [
      item({ command: FENCE_CMD.inclusionVertex, param1: 4, x: 1, y: 1 }),
      item({ command: FENCE_CMD.inclusionVertex, param1: 4, x: 2, y: 1 }),
    ]
    const { plan, problems } = fenceFromItems(items)
    expect(plan.shapes).toHaveLength(0)
    expect(problems.join(' ')).toMatch(/2 of 4/)
  })

  it('keeps a short polygon that still has three corners, and says so', () => {
    const items = [
      item({ command: FENCE_CMD.inclusionVertex, param1: 5, x: 1, y: 1 }),
      item({ command: FENCE_CMD.inclusionVertex, param1: 5, x: 2, y: 1 }),
      item({ command: FENCE_CMD.inclusionVertex, param1: 5, x: 2, y: 2 }),
    ]
    const { plan, problems } = fenceFromItems(items)
    expect(plan.shapes).toHaveLength(1)
    expect(problems.join(' ')).toMatch(/declared 5/)
  })

  it('keeps the first of two return points', () => {
    const items = [
      item({ command: FENCE_CMD.returnPoint, x: 10, y: 10 }),
      item({ command: FENCE_CMD.returnPoint, x: 20, y: 20 }),
    ]
    const { plan, problems } = fenceFromItems(items)
    expect(plan.returnPoint).toEqual({ x: 10, y: 10 })
    expect(problems).toHaveLength(1)
  })

  it('makes no items for an empty fence', () => {
    expect(fenceToItems({ shapes: [], returnPoint: null })).toEqual([])
  })
})

describe('rally points', () => {
  it('round trips, relative to home', () => {
    const points = [
      { uid: 'a', x: 391000000, y: -1191000000, altM: 60 },
      { uid: 'b', x: 391010000, y: -1191010000, altM: 80 },
    ]
    const items = rallyToItems(points)
    expect(items.every((i) => i.command === RALLY_CMD)).toBe(true)
    // Relative-to-home, not AMSL: an absolute rally altitude is a good way to
    // send an aircraft to the wrong height.
    expect(items.every((i) => i.frame === 3)).toBe(true)
    const back = rallyFromItems(items)
    expect(back.map((p) => [p.x, p.y, p.altM])).toEqual(points.map((p) => [p.x, p.y, p.altM]))
  })

  it('ignores anything that is not a rally point', () => {
    expect(rallyFromItems([item({ command: 16, x: 1, y: 1 })])).toEqual([])
  })
})

describe('containsPoint', () => {
  const inside = { x: 390995000, y: -1190995000 }
  const outside = { x: 391050000, y: -1190995000 }

  it('tests a polygon', () => {
    expect(containsPoint(poly(true), inside)).toBe(true)
    expect(containsPoint(poly(true), outside)).toBe(false)
  })

  it('tests a circle', () => {
    const c: FenceShape = { uid: 'c', kind: 'circle', inclusive: true, center: inside, radiusM: 100 }
    expect(containsPoint(c, inside)).toBe(true)
    expect(containsPoint(c, outside)).toBe(false)
  })
})

describe('validateFence', () => {
  it('accepts a fence whose return point is inside the inclusion', () => {
    expect(
      validateFence({ shapes: [poly(true)], returnPoint: { x: 390995000, y: -1190995000 } }),
    ).toEqual([])
  })

  it('catches a return point outside every inclusion fence', () => {
    const out = validateFence({
      shapes: [poly(true)],
      returnPoint: { x: 391050000, y: -1190995000 },
    })
    expect(out.join(' ')).toMatch(/outside every inclusion/)
  })

  it('catches a return point inside an exclusion fence', () => {
    const out = validateFence({
      shapes: [poly(false)],
      returnPoint: { x: 390995000, y: -1190995000 },
    })
    expect(out.join(' ')).toMatch(/inside an exclusion/)
  })

  it('catches a zero-radius circle and a two-corner polygon', () => {
    const out = validateFence({
      shapes: [
        { uid: 'c', kind: 'circle', inclusive: true, center: SQUARE[0]!, radiusM: 0 },
        poly(true, SQUARE.slice(0, 2)),
      ],
      returnPoint: null,
    })
    expect(out).toHaveLength(2)
  })

  it('says nothing about a return point when there is no inclusion fence', () => {
    expect(validateFence({ shapes: [poly(false, SQUARE)], returnPoint: null })).toEqual([])
  })
})

describe('distanceM', () => {
  it('measures a tenth of a degree of latitude as about 11 km', () => {
    const d = distanceM({ x: 390000000, y: -1190000000 }, { x: 391000000, y: -1190000000 })
    expect(d).toBeGreaterThan(11000)
    expect(d).toBeLessThan(11200)
  })

  it('shrinks longitude by the cosine of the latitude', () => {
    const atEquator = distanceM({ x: 0, y: 0 }, { x: 0, y: 1000000 })
    const atSixty = distanceM({ x: 600000000, y: 0 }, { x: 600000000, y: 1000000 })
    expect(atSixty / atEquator).toBeCloseTo(0.5, 2)
  })
})
