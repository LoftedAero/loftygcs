import { beforeEach, describe, expect, it } from 'vitest'
import { isDirty, useMissionStore } from './mission-store'
import { planFromItems } from '../protocol/mission-plan'
import type { MissionItem } from '../protocol/types'

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

const store = () => useMissionStore.getState()

beforeEach(() => {
  useMissionStore.setState({
    plan: { home: null, items: [] },
    synced: null,
    defaults: { altM: 50, frame: 3 },
    selected: null,
    transfer: { kind: 'idle' },
    sourceName: null,
  })
})

describe('adding items', () => {
  it('gives a new item the current defaults and selects it', () => {
    store().setDefaults({ altM: 80, frame: 0 })
    const uid = store().addItem(16, { x: 1, y: 2 })
    const item = store().plan.items[0]!
    expect(item).toMatchObject({ command: 16, z: 80, frame: 0, x: 1, y: 2 })
    expect(store().selected).toBe(uid)
  })

  it('puts a takeoff first, wherever it was added', () => {
    // A takeoff after the waypoints is not a mission anyone means to fly,
    // and ArduPilot will not start one that does not begin with it.
    store().addItem(16, { x: 1, y: 1 })
    store().addItem(16, { x: 2, y: 2 })
    store().addItem(22)
    expect(store().plan.items.map((i) => i.command)).toEqual([22, 16, 16])
  })

  it('leaves position at zero for commands that have none', () => {
    // NAV_TAKEOFF climbs where the vehicle stands; a coordinate here would
    // be carried to the vehicle and quietly ignored, or worse, honored.
    store().addItem(22, { x: 5, y: 6 })
    expect(store().plan.items[0]).toMatchObject({ x: 0, y: 0 })
  })
})

describe('reordering and removing', () => {
  it('moves an item and keeps the rest in order', () => {
    const a = store().addItem(16, { x: 1, y: 1 })
    store().addItem(16, { x: 2, y: 2 })
    store().addItem(16, { x: 3, y: 3 })
    store().moveItem(a, 2)
    expect(store().plan.items.map((i) => i.x)).toEqual([2, 3, 1])
  })

  it('clamps a move past the ends rather than losing the item', () => {
    const a = store().addItem(16, { x: 1, y: 1 })
    store().addItem(16, { x: 2, y: 2 })
    store().moveItem(a, 99)
    expect(store().plan.items.map((i) => i.x)).toEqual([2, 1])
  })

  it('clears the selection when the selected item goes', () => {
    const uid = store().addItem(16, { x: 1, y: 1 })
    expect(store().selected).toBe(uid)
    store().removeItem(uid)
    expect(store().selected).toBeNull()
    expect(store().plan.items).toHaveLength(0)
  })
})

describe('dirty tracking', () => {
  it('is clean only when the vehicle has been told', () => {
    // Nothing planned and nothing known: not dirty, nothing to write.
    expect(isDirty(store())).toBe(false)

    store().addItem(16, { x: 1, y: 1 })
    // Planned but never uploaded: the vehicle does not have this.
    expect(isDirty(store())).toBe(true)

    store().markSynced()
    expect(isDirty(store())).toBe(false)

    store().addItem(16, { x: 2, y: 2 })
    expect(isDirty(store())).toBe(true)
  })

  it('stays clean through a read-back that renames nothing', () => {
    // The round trip that matters: read, upload, read again. An RTL has
    // neither a position nor an altitude, so ArduPilot stores no frame for
    // it and reports 0 whatever went up -- that must not read as an edit.
    const downloaded = [
      wire(0, { frame: 0, z: 584 }),
      wire(1),
      wire(2, { command: 20, frame: 3, x: 0, y: 0, z: 0 }),
    ]
    store().setPlan(planFromItems(downloaded), { synced: true })
    expect(isDirty(store())).toBe(false)

    const readBack = [
      wire(0, { frame: 0, z: 584 }),
      wire(1),
      wire(2, { command: 20, frame: 0, x: 0, y: 0, z: 0 }),
    ]
    store().setPlan(planFromItems(readBack), { synced: false })
    expect(isDirty(store())).toBe(false)

    // A takeoff, by contrast, does carry an altitude -- so its frame is the
    // difference between 40 m above home and 40 m above the sea, and a
    // change there is a real edit that must show.
    store().setPlan(planFromItems([wire(0), wire(1, { command: 22, x: 0, y: 0 })]), {
      synced: true,
    })
    store().setPlan(
      planFromItems([wire(0), wire(1, { command: 22, x: 0, y: 0, frame: 0 })]),
      { synced: false },
    )
    expect(isDirty(store())).toBe(true)
  })

  it('treats a loaded file as not yet on the vehicle', () => {
    store().setPlan(planFromItems([wire(0), wire(1)]), { synced: true })
    // Loading must not claim the vehicle has the new plan.
    store().setPlan(planFromItems([wire(0), wire(1), wire(2)]), { name: 'a.waypoints' })
    expect(isDirty(store())).toBe(true)
    expect(store().sourceName).toBe('a.waypoints')
  })
})
