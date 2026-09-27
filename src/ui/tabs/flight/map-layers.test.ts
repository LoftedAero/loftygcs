import { describe, expect, it } from 'vitest'
import { BASE_LAYERS, layerById } from './map-layers'
import { modeNumberByName, modeTable } from '../../../protocol/modes'

describe('base layers', () => {
  it('defaults to satellite', () => {
    expect(BASE_LAYERS[0]?.id).toBe('satellite')
    expect(layerById('satellite').id).toBe('satellite')
  })

  it('falls back to the first layer for an unknown id', () => {
    // A stale id in localStorage must not leave the map with no tiles.
    expect(layerById('nonsense' as 'satellite').id).toBe('satellite')
  })

  it('carries attribution on every layer', () => {
    // Esri's imagery terms require the credit to stay visible.
    for (const l of BASE_LAYERS) {
      expect(l.attribution.length, `${l.id} needs attribution`).toBeGreaterThan(10)
    }
  })

  it('lets the map zoom past the deepest tiles rather than going blank', () => {
    for (const l of BASE_LAYERS) {
      expect(l.maxZoom).toBeGreaterThanOrEqual(l.maxNativeZoom)
    }
  })

  it('uses Esri tile order for the imagery service', () => {
    // ArcGIS orders its tiles {z}/{y}/{x}; the usual {z}/{x}/{y} silently
    // serves the wrong tile.
    const sat = layerById('satellite')
    expect(sat.url).toContain('{z}/{y}/{x}')
  })
})

describe('modeNumberByName', () => {
  const COPTER = 2 // MAV_TYPE_QUADROTOR
  const PLANE = 1 // MAV_TYPE_FIXED_WING

  it('resolves the same name to different numbers per vehicle', () => {
    // Auto is 3 on Copter and 10 on Plane; RTL is 6 and 11.
    expect(modeNumberByName(COPTER, 'Auto')).toBe(3)
    expect(modeNumberByName(PLANE, 'Auto')).toBe(10)
    expect(modeNumberByName(COPTER, 'RTL')).toBe(6)
    expect(modeNumberByName(PLANE, 'RTL')).toBe(11)
  })

  it('is case insensitive', () => {
    expect(modeNumberByName(COPTER, 'rtl')).toBe(6)
  })

  it('returns undefined for a mode the vehicle does not have', () => {
    expect(modeNumberByName(COPTER, 'FBWA')).toBeUndefined()
    expect(modeNumberByName(PLANE, 'PosHold')).toBeUndefined()
  })

  it('round-trips every mode in each table', () => {
    for (const type of [COPTER, PLANE]) {
      for (const [num, name] of Object.entries(modeTable(type))) {
        expect(modeNumberByName(type, name)).toBe(Number(num))
      }
    }
  })
})
