import { describe, expect, it } from 'vitest'
import {
  distanceM,
  legStats,
  planFromItems,
  planToItems,
  plansDiffer,
  type MissionPlan,
  type PlanItem,
} from './mission-plan'
import type { MissionItem } from './types'

const wire = (seq: number, over: Partial<MissionItem> = {}): MissionItem => ({
  seq,
  frame: 3,
  command: 16,
  current: seq === 0 ? 1 : 0,
  autocontinue: 1,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
  x: -353632621,
  y: 1491652374,
  z: 50,
  ...over,
})

const plan = (items: Partial<PlanItem>[], home = { x: -353632621, y: 1491652374, z: 584 }) => ({
  home,
  items: items.map((o, i) => ({
    uid: `u${i}`,
    frame: 3,
    command: 16,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: -353632621,
    y: 1491652374,
    z: 50,
    ...o,
  })),
})

describe('plan <-> wire', () => {
  it('takes item 0 as home and the rest as editable items', () => {
    const p = planFromItems([wire(0, { frame: 0, z: 584 }), wire(1), wire(2, { command: 20 })])
    expect(p.home).toEqual({ x: -353632621, y: 1491652374, z: 584 })
    expect(p.items).toHaveLength(2)
    expect(p.items[1]!.command).toBe(20)
    // Items get identities of their own, not sequence numbers.
    expect(new Set(p.items.map((i) => i.uid)).size).toBe(2)
  })

  it('renumbers on the way out, home first', () => {
    const out = planToItems(plan([{ command: 22 }, {}, { command: 20 }]))
    expect(out.map((i) => i.seq)).toEqual([0, 1, 2, 3])
    expect(out[0]).toMatchObject({ command: 16, frame: 0, current: 1 })
    expect(out[3]!.command).toBe(20)
  })

  it('round-trips a downloaded mission unchanged', () => {
    const original = [wire(0, { frame: 0, z: 584 }), wire(1, { command: 22, x: 0, y: 0 }), wire(2)]
    expect(planToItems(planFromItems(original))).toEqual(original)
  })

  it('survives an empty mission', () => {
    const p = planFromItems([])
    expect(p.home).toBeNull()
    expect(p.items).toEqual([])
    expect(planToItems(p)).toHaveLength(1) // home alone
  })
})

describe('plansDiffer', () => {
  it('sees a moved waypoint and a changed altitude', () => {
    const a = plan([{}])
    expect(plansDiffer(a, plan([{ x: -353600000 }]))).toBe(true)
    expect(plansDiffer(a, plan([{ z: 60 }]))).toBe(true)
    expect(plansDiffer(a, plan([{ param1: 5 }]))).toBe(true)
    expect(plansDiffer(a, plan([{}, {}]))).toBe(true)
  })

  it('ignores uid, which is ours alone', () => {
    const a = plan([{}])
    const b: MissionPlan = { ...a, items: a.items.map((i) => ({ ...i, uid: 'different' })) }
    expect(plansDiffer(a, b)).toBe(false)
  })

  it('ignores frame on commands that carry no position', () => {
    // An RTL uploaded as frame 3 reads back as frame 0, which is not an edit.
    const uploaded = plan([{ command: 20, frame: 3, x: 0, y: 0 }])
    const readBack = plan([{ command: 20, frame: 0, x: 0, y: 0 }])
    expect(plansDiffer(uploaded, readBack)).toBe(false)

    // But a frame change on a waypoint is real and must show.
    expect(plansDiffer(plan([{ frame: 3 }]), plan([{ frame: 0 }]))).toBe(true)
  })

  it('tolerates float32 round-trip noise', () => {
    // 50 m through a float32 comes back as 50.000001; that is not an edit.
    expect(plansDiffer(plan([{ z: 50 }]), plan([{ z: 50.00001 }]))).toBe(false)
    expect(plansDiffer(plan([{ z: 50 }]), plan([{ z: 50.5 }]))).toBe(true)
  })

  it('notices home moving', () => {
    const a = plan([{}])
    expect(plansDiffer(a, { ...a, home: { x: 1, y: 2, z: 3 } })).toBe(true)
    expect(plansDiffer(a, { ...a, home: null })).toBe(true)
  })
})

describe('distances', () => {
  it('measures a known short leg', () => {
    // 0.001 degrees of latitude is about 111 m anywhere on earth.
    const d = distanceM({ x: -353632621, y: 1491652374 }, { x: -353632621 + 10000, y: 1491652374 })
    expect(d).toBeGreaterThan(108)
    expect(d).toBeLessThan(114)
  })

  it('accumulates along the route and carries the total past unlocated items', () => {
    const p = plan([
      { command: 22, x: 0, y: 0 }, // takeoff: no position
      { x: -353632621 + 10000 }, // ~111 m from home
      { command: 178, x: 0, y: 0 }, // change speed: no position
      { x: -353632621 + 20000 }, // another ~111 m
    ])
    const stats = legStats(p)
    expect(stats[0]!.legM).toBe(0)
    expect(stats[0]!.totalM).toBe(0)
    expect(stats[1]!.legM).toBeGreaterThan(108)
    // The unlocated item inherits the total rather than resetting it.
    expect(stats[2]!.totalM).toBeCloseTo(stats[1]!.totalM, 6)
    expect(stats[3]!.totalM).toBeGreaterThan(stats[1]!.totalM)
  })
})
