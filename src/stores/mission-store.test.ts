import { beforeEach, describe, expect, it } from 'vitest'
import { fenceDirty, isDirty, rallyDirty, useMissionStore } from './mission-store'
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
    survey: null,
    editing: 'mission',
    fence: { shapes: [], returnPoint: null },
    fenceSynced: null,
    rally: [],
    rallySynced: null,
    selectedShape: null,
    fenceTool: null,
    fenceDraft: [],
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

describe('fence editing', () => {
  const at = (x: number, y: number) => ({ x, y })

  it('collects polygon corners and refuses to finish under three', () => {
    store().setEditing('fence')
    store().setFenceTool('inclusionPolygon')
    store().placeFencePoint(at(1, 1))
    store().placeFencePoint(at(2, 1))
    store().finishFenceShape()
    expect(store().fence.shapes).toHaveLength(0)
    expect(store().fenceDraft).toHaveLength(2)

    store().placeFencePoint(at(2, 2))
    store().finishFenceShape()
    expect(store().fence.shapes).toHaveLength(1)
    // The tool disarms and the draft empties, so the next click does not
    // start extending the shape that was just committed.
    expect(store().fenceTool).toBeNull()
    expect(store().fenceDraft).toEqual([])
  })

  it('places a whole circle from one click, selected and ready to size', () => {
    store().setFenceTool('exclusionCircle')
    store().placeFencePoint(at(10, 20))
    const shape = store().fence.shapes[0]!
    expect(shape.kind).toBe('circle')
    expect(shape.inclusive).toBe(false)
    expect(store().selectedShape).toBe(shape.uid)
    expect(store().fenceTool).toBeNull()
    store().updateShape(shape.uid, { radiusM: 250 })
    const sized = store().fence.shapes[0]!
    expect(sized.kind === 'circle' && sized.radiusM).toBe(250)
  })

  it('places the return point and lets it be removed', () => {
    store().setFenceTool('returnPoint')
    store().placeFencePoint(at(5, 6))
    expect(store().fence.returnPoint).toEqual({ x: 5, y: 6 })
    store().setFenceReturn(null)
    expect(store().fence.returnPoint).toBeNull()
  })

  it('ignores a click with no tool armed', () => {
    store().setEditing('fence')
    store().placeFencePoint(at(1, 1))
    expect(store().fence.shapes).toEqual([])
    expect(store().fenceDraft).toEqual([])
  })

  it('abandons a half-drawn polygon when the plan being edited changes', () => {
    store().setFenceTool('inclusionPolygon')
    store().placeFencePoint(at(1, 1))
    store().placeFencePoint(at(2, 2))
    store().setEditing('rally')
    // A two-corner polygon is not a fence, and keeping it would resurface
    // later as a shape the vehicle rejects.
    expect(store().fenceDraft).toEqual([])
    expect(store().fenceTool).toBeNull()
  })

  it('moves one vertex of one shape and leaves the others alone', () => {
    store().setFenceTool('inclusionPolygon')
    for (const p of [at(1, 1), at(2, 1), at(2, 2)]) store().placeFencePoint(p)
    store().finishFenceShape()
    const uid = store().fence.shapes[0]!.uid
    store().moveShapeVertex(uid, 1, at(9, 9))
    const pts = store().fence.shapes[0]!
    expect(pts.kind === 'polygon' && pts.points).toEqual([at(1, 1), at(9, 9), at(2, 2)])
  })

  it('is dirty until read or written, and clean straight after', () => {
    expect(fenceDirty(useMissionStore.getState())).toBe(false)
    store().setFenceTool('inclusionCircle')
    store().placeFencePoint(at(1, 1))
    expect(fenceDirty(useMissionStore.getState())).toBe(true)
    store().setFence(store().fence, { synced: true })
    expect(fenceDirty(useMissionStore.getState())).toBe(false)
    // The synced copy is a clone, so editing the live one still shows.
    store().updateShape(store().fence.shapes[0]!.uid, { radiusM: 999 })
    expect(fenceDirty(useMissionStore.getState())).toBe(true)
  })
})

describe('rally editing', () => {
  it('adds points at the default altitude and tracks dirtiness', () => {
    store().setDefaults({ altM: 70 })
    store().setEditing('rally')
    store().addRally({ x: 1, y: 2 })
    expect(store().rally[0]).toMatchObject({ x: 1, y: 2, altM: 70 })
    expect(rallyDirty(useMissionStore.getState())).toBe(true)
    store().setRally(store().rally, { synced: true })
    expect(rallyDirty(useMissionStore.getState())).toBe(false)
    store().updateRally(store().rally[0]!.uid, { altM: 90 })
    expect(rallyDirty(useMissionStore.getState())).toBe(true)
  })

  it('clears the selection when the selected point is removed', () => {
    store().addRally({ x: 1, y: 2 })
    const uid = store().rally[0]!.uid
    expect(store().selectedShape).toBe(uid)
    store().removeRally(uid)
    expect(store().rally).toEqual([])
    expect(store().selectedShape).toBeNull()
  })
})
