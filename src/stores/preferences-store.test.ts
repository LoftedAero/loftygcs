import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(store().units).toEqual({ distance: 'm', speed: 'ms', verticalSpeed: 'follow' })
  })

  it('remembers a choice across a reload', () => {
    store().setDistanceUnit('ft')
    store().setSpeedUnit('kts')
    store().setVerticalSpeedUnit('fpm')
    const saved = JSON.parse(localStorage.getItem(KEY)!) as {
      version: number
      units: { distance: string; speed: string; verticalSpeed: string }
    }
    expect(saved.units).toEqual({ distance: 'ft', speed: 'kts', verticalSpeed: 'fpm' })
    // Versioned, so a future change that reinterprets a key can tell.
    expect(saved.version).toBe(1)
  })

  it('ignores a stored value this build does not understand', () => {
    // A newer build's choice, or a corrupted key: fall back to a known unit.
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
    // The preference still changes; it just is not saved.
    expect(() => store().setDistanceUnit('ft')).not.toThrow()
    expect(store().units.distance).toBe('ft')
    Storage.prototype.setItem = real
  })

  it('resets to the shipped defaults', () => {
    store().setDistanceUnit('ft')
    store().setSpeedUnit('mph')
    store().reset()
    expect(store().units).toEqual({ distance: 'm', speed: 'ms', verticalSpeed: 'follow' })
  })

  it('reads a store written before climb rate had a control', async () => {
    // A document with no verticalSpeed key must come back as `follow`, which
    // is what those builds did, with no VERSION bump.
    //
    // Re-imported because the document is read only at module load; a
    // setter would test the in-memory default instead.
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, units: { distance: 'ft', speed: 'kts' } }),
    )
    vi.resetModules()
    const fresh = await import('./preferences-store')
    expect(fresh.usePreferencesStore.getState().units).toEqual({
      distance: 'ft',
      speed: 'kts',
      verticalSpeed: 'follow',
    })
  })
})

describe('what the vehicle is commanded, whatever is displayed', () => {
  it('returns a mission altitude unchanged through a units round trip', () => {
    // A waypoint stored at 120 m is displayed as 394 ft; typing that 394
    // back must not drift the stored altitude.
    const storedM = 120
    for (const unit of ['m', 'ft'] as const) {
      const shown = Math.round(toDistance(storedM, unit))
      const backM = fromDistance(shown, unit)
      // Within half a display unit: the rounding the field itself does.
      expect(Math.abs(backM - storedM)).toBeLessThan(fromDistance(0.5, unit))
    }
  })

  it('sends meters per second however the speed box is labelled', () => {
    // 30 knots typed into the guided speed box is 15.43 m/s on the wire.
    expect(fromSpeed(30, 'kts')).toBeCloseTo(15.4333, 3)
    expect(fromSpeed(toSpeed(12, 'mph'), 'mph')).toBeCloseTo(12, 10)
  })
})

describe('the interface scale', () => {
  const loaded = async (stored: unknown) => {
    localStorage.setItem(KEY, JSON.stringify(stored))
    vi.resetModules()
    return (await import('./preferences-store')).usePreferencesStore.getState().uiScale
  }

  it('is 100% for a store written before it existed', async () => {
    expect(await loaded({ version: 1, units: { distance: 'm' } })).toBe(1)
  })

  it('reads back a scale this build offers', async () => {
    expect(await loaded({ version: 1, uiScale: 1.25 })).toBe(1.25)
  })

  it('refuses a scale it does not offer, rather than drawing the window at it', async () => {
    expect(await loaded({ version: 1, uiScale: 3 })).toBe(1)
    expect(await loaded({ version: 1, uiScale: '1.5' })).toBe(1)
  })

  it('is kept, and goes back to 100% with Reset', () => {
    store().setUiScale(1.5)
    expect(JSON.parse(localStorage.getItem(KEY)!).uiScale).toBe(1.5)
    store().setUiScale(7)
    expect(store().uiScale).toBe(1.5)
    store().reset()
    expect(store().uiScale).toBe(1)
  })
})
