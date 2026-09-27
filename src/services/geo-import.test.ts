import { beforeEach, describe, expect, it } from 'vitest'
import { useMissionStore } from '../stores/mission-store'
import {
  applyGeoShapes,
  destinationFor,
  exportable,
  MAX_IMPORT_ITEMS,
  usableShapes,
} from './geo-import'
import type { GeoFix, GeoShape } from './geo-file'

// These drive the real store, because what an imported shape becomes
// depends on which of the three plans is on screen.

const HOME = { x: 399500000, y: -1052500000, z: 1900 }

const shape = (kind: GeoShape['kind'], fixes: GeoFix[], name: string | null = null): GeoShape => ({
  kind,
  name,
  fixes,
})

const line = (n: number, amslM: number | null = null): GeoFix[] =>
  Array.from({ length: n }, (_, i) => ({ lat: 39.95 + i * 0.001, lon: -105.25, amslM }))

beforeEach(() => {
  const store = useMissionStore.getState()
  store.clear()
  store.setEditing('mission')
  store.setFence({ shapes: [], returnPoint: null })
  store.setRally([])
  store.cancelSurvey()
  store.setDefaults({ altM: 50, frame: 3 })
  store.setHome({ ...HOME })
})

describe('what an import becomes', () => {
  it('follows the plan on screen, not the file', () => {
    expect(destinationFor('mission')).toBe('waypoints')
    expect(destinationFor('fence')).toBe('fence')
    expect(destinationFor('rally')).toBe('rally')
  })

  it('takes the shapes that suit where they are going', () => {
    // A file often holds a route beside the area it crosses; taking the
    // wrong one is worse than taking none.
    const mixed = [shape('track', line(3)), shape('polygon', line(4)), shape('points', line(2))]
    expect(usableShapes(mixed, 'fence').map((s) => s.kind)).toEqual(['polygon'])
    expect(usableShapes(mixed, 'waypoints').map((s) => s.kind)).toEqual(['track', 'points'])
    expect(usableShapes([shape('polygon', line(4))], 'waypoints')).toEqual([])
  })
})

describe('applying several shapes at once', () => {
  it('stitches tracks into one route', () => {
    // A path drawn in Google Earth comes back in the pieces it was drawn in.
    applyGeoShapes([shape('track', line(3)), shape('track', line(4))], 'route.kml')
    expect(useMissionStore.getState().plan.items).toHaveLength(7)
  })

  it('adds one fence shape per area, with the type it was given', () => {
    useMissionStore.getState().setEditing('fence')
    applyGeoShapes([shape('polygon', line(4)), shape('polygon', line(5))], 'fences.kml', {
      inclusive: false,
    })
    const fence = useMissionStore.getState().fence.shapes
    expect(fence).toHaveLength(2)
    expect(fence.every((f) => !f.inclusive)).toBe(true)
  })

  it('can be told to use a destination the shapes would not pick', () => {
    // What the mismatch prompt offers: areas in a file, while planning.
    applyGeoShapes([shape('polygon', line(5))], 'field.kml', { as: 'survey' })
    expect(useMissionStore.getState().survey?.polygon).toHaveLength(5)
  })
})

describe('importing waypoints', () => {
  it('converts a file elevation into the editor frame', () => {
    // Home is 1900 m AMSL and the file says 2000, so the relative altitude
    // is 100.
    applyGeoShapes([shape('track', line(3, 2000))], 'ridge.gpx')
    const items = useMissionStore.getState().plan.items
    expect(items).toHaveLength(3)
    expect(items.every((it) => it.z === 100)).toBe(true)
    expect(items[0]!.frame).toBe(3)
  })

  it('takes the elevation as it stands in the AMSL frame', () => {
    useMissionStore.getState().setDefaults({ frame: 0 })
    applyGeoShapes([shape('track', line(2, 2000))], 'ridge.gpx')
    expect(useMissionStore.getState().plan.items[0]!.z).toBe(2000)
  })

  it('uses the default altitude when nothing can be converted', () => {
    // No home elevation, so the file's AMSL values cannot be converted.
    useMissionStore.getState().setHome({ x: HOME.x, y: HOME.y, z: 0 })
    applyGeoShapes([shape('track', line(2, 2000))], 'ridge.gpx')
    expect(useMissionStore.getState().plan.items[0]!.z).toBe(50)
  })

  it('uses the default altitude for a file that carries none', () => {
    applyGeoShapes([shape('track', line(2))], 'ridge.gpx')
    expect(useMissionStore.getState().plan.items[0]!.z).toBe(50)
  })

  it('puts the coordinates where the file put them', () => {
    applyGeoShapes([shape('track', line(2))], 'ridge.gpx')
    const [first] = useMissionStore.getState().plan.items
    expect(first!.x).toBe(399500000)
    expect(first!.y).toBe(-1052500000)
  })

  it('simplifies a track that would not fit, and says so', () => {
    const summary = applyGeoShapes([shape('track', line(600))], 'walk.gpx')
    const items = useMissionStore.getState().plan.items
    expect(items.length).toBeLessThanOrEqual(MAX_IMPORT_ITEMS)
    expect(summary).toMatch(/simplified from 600 points/)
  })

  it('does not say "simplified" about a track that fitted', () => {
    expect(applyGeoShapes([shape('track', line(5))], 'short.gpx')).not.toMatch(/simplified/)
  })

  it('keeps home, which the file has nothing to say about', () => {
    applyGeoShapes([shape('track', line(3))], 'ridge.gpx')
    expect(useMissionStore.getState().plan.home).toEqual(HOME)
  })

  it('names the plan after the file it came from', () => {
    applyGeoShapes([shape('track', line(3))], 'ridge.gpx')
    expect(useMissionStore.getState().sourceName).toBe('ridge.gpx')
  })
})

describe('importing into the other two plans', () => {
  it('adds a fence polygon while the fence is being edited', () => {
    useMissionStore.getState().setEditing('fence')
    applyGeoShapes([shape('polygon', line(6))], 'boundary.kml')
    const added = useMissionStore.getState().fence.shapes[0]!
    expect(added.kind).toBe('polygon')
    expect(added.kind === 'polygon' && added.points.length).toBe(6)
    expect(added.inclusive).toBe(true)
  })

  it('keeps the fence shapes that were already there', () => {
    useMissionStore.getState().setEditing('fence')
    applyGeoShapes([shape('polygon', line(4))], 'a.kml')
    applyGeoShapes([shape('polygon', line(4))], 'b.kml')
    expect(useMissionStore.getState().fence.shapes).toHaveLength(2)
  })

  it('adds rally points, few of them', () => {
    useMissionStore.getState().setEditing('rally')
    applyGeoShapes([shape('points', line(40))], 'fields.kml')
    // Rally points are a handful of alternates, never a route.
    expect(useMissionStore.getState().rally.length).toBeLessThanOrEqual(10)
    expect(useMissionStore.getState().rally.length).toBeGreaterThan(1)
  })

  it('leaves the mission alone when told to draw a survey area', () => {
    applyGeoShapes([shape('polygon', line(5))], 'field.kml', { as: 'survey' })
    expect(useMissionStore.getState().survey?.polygon).toHaveLength(5)
    // The polygon is the input to a survey, not the plan itself.
    expect(useMissionStore.getState().plan.items).toHaveLength(0)
  })
})

describe('what there is to export', () => {
  // The buttons are on all three plans: an empty plan has nothing to
  // write, and GPX cannot express a fence.
  it('has nothing to offer for an empty plan', () => {
    for (const plan of ['mission', 'fence', 'rally'] as const) {
      expect(exportable(plan)).toEqual({ kml: false, gpx: false })
    }
  })

  it('offers KML but never GPX for a fence, which has no way to hold an area', () => {
    useMissionStore.getState().setEditing('fence')
    applyGeoShapes([shape('polygon', line(5))], 'boundary.kml')
    expect(exportable('fence')).toEqual({ kml: true, gpx: false })
  })

  it('offers both for rally points and for a mission', () => {
    useMissionStore.getState().setEditing('rally')
    applyGeoShapes([shape('points', line(3))], 'fields.kml')
    expect(exportable('rally')).toEqual({ kml: true, gpx: true })

    useMissionStore.getState().setEditing('mission')
    applyGeoShapes([shape('track', line(4))], 'route.gpx')
    expect(exportable('mission')).toEqual({ kml: true, gpx: true })
  })
})
