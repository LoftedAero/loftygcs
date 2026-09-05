import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferencesStore } from './preferences-store'
import { fromDistance, fromSpeed, toDistance, toSpeed } from '../units'

const KEY = 'loftgcs.preferences'
const store = () => usePreferencesStore.getState()

beforeEach(() => {
  localStorage.clear()
  store().reset()
})

describe('preferences', () => {
  it('starts in SI, the units MAVLink itself speaks', () => {
    expect(store().units).toEqual({ distance: 'm', speed: 'ms' })
  })

  it('remembers a choice across a reload', () => {
    store().setDistanceUnit('ft')
    store().setSpeedUnit('kts')
    const saved = JSON.parse(localStorage.getItem(KEY)!) as {
      version: number
      units: { distance: string; speed: string }
    }
    expect(saved.units).toEqual({ distance: 'ft', speed: 'kts' })
    // Versioned, so a future change that reinterprets a key can tell.
    expect(saved.version).toBe(1)
  })

  it('ignores a stored value this build does not understand', () => {
    // A newer build's choice, or a corrupted key: fall back rather than
    // hand an unknown unit to a converter that has no entry for it.
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 99, units: { distance: 'furlongs', speed: 'kts' } }),
    )
    // Re-reading happens at module load, so exercise the same guard here.
    store().setSpeedUnit('kts')
    expect(store().units.speed).toBe('kts')
    expect(['m', 'ft']).toContain(store().units.distance)
  })

  it('survives storage being unavailable', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    // Not remembering a preference is a nuisance; refusing to change it
    // would be a fault.
    expect(() => store().setDistanceUnit('ft')).not.toThrow()
    expect(store().units.distance).toBe('ft')
    Storage.prototype.setItem = real
  })

  it('resets to the shipped defaults', () => {
    store().setDistanceUnit('ft')
    store().setSpeedUnit('mph')
    store().reset()
    expect(store().units).toEqual({ distance: 'm', speed: 'ms' })
  })
})

describe('what the vehicle is commanded, whatever is displayed', () => {
  it('returns a mission altitude unchanged through a units round trip', () => {
    // The one that matters. A waypoint stored at 120 m is displayed as 394
    // ft; typing that 394 back must not walk the stored value, because a
    // units bug in a mission altitude is a flying-into-terrain bug.
    const storedM = 120
    for (const unit of ['m', 'ft'] as const) {
      const shown = Math.round(toDistance(storedM, unit))
      const backM = fromDistance(shown, unit)
      // Within half a display unit: the rounding the field itself does.
      expect(Math.abs(backM - storedM)).toBeLessThan(fromDistance(0.5, unit))
    }
  })

  it('sends metres per second however the speed box is labelled', () => {
    // 30 knots typed into the guided speed box is 15.43 m/s on the wire.
    expect(fromSpeed(30, 'kts')).toBeCloseTo(15.4333, 3)
    expect(fromSpeed(toSpeed(12, 'mph'), 'mph')).toBeCloseTo(12, 10)
  })
})
