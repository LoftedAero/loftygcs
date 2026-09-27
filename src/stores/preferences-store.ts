import { create } from 'zustand'
import type { VehicleClass } from '../protocol/modes'
import {
  DEFAULT_UNITS,
  type DistanceUnit,
  type SpeedUnit,
  type UnitPrefs,
  type VerticalSpeedUnit,
} from '../units'

// User preferences, stored as one versioned document. Unknown keys are
// ignored and missing ones fall back to defaults, so adding a preference
// needs no migration and older builds can read newer stores. Only
// reinterpreting an existing key requires bumping VERSION.
//
// Theme lives in theme-store because index.html's inline script applies it
// before first paint.

const STORAGE_KEY = 'loftgcs.preferences'
const VERSION = 1

export interface Preferences {
  units: UnitPrefs
  /**
   * Which vehicle's command set to offer when planning with nothing
   * connected (spline waypoints and payload place are Copter-only). Like
   * QGroundControl's `offlineEditingVehicleClass`. A preference rather than
   * plan state, since it belongs to the user.
   */
  planFor: VehicleClass
  /**
   * Interface scale, 1 being 100%. Applied as page zoom in the desktop app;
   * in a browser the page cannot set zoom.
   */
  uiScale: number
}

/** The scales offered. */
export const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.5] as const

const DEFAULTS: Preferences = {
  units: DEFAULT_UNITS,
  // Copter's command set is a superset, so a wrong default adds an unused
  // entry rather than hiding one.
  planFor: 'copter',
  uiScale: 1,
}

/** Reads the stored preferences, ignoring anything this build does not recognize. */
function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as {
      version?: number
      units?: Partial<UnitPrefs>
      planFor?: string
      uiScale?: number
    }
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS
    return {
      units: {
        distance: valid(parsed.units?.distance, ['m', 'ft'], DEFAULTS.units.distance),
        speed: valid(parsed.units?.speed, ['ms', 'kmh', 'kts', 'mph'], DEFAULTS.units.speed),
        // Older stores lack this; the `follow` default matches their behavior.
        verticalSpeed: valid(
          parsed.units?.verticalSpeed,
          ['follow', 'ms', 'fpm'],
          DEFAULTS.units.verticalSpeed,
        ),
      },
      // Older stores lack this; the default matches their behavior.
      planFor: valid(parsed.planFor, ['copter', 'plane', 'rover', 'other'], DEFAULTS.planFor),
      // Any scale this build does not offer falls back to 100%.
      uiScale: (UI_SCALES as readonly number[]).includes(parsed.uiScale as number)
        ? (parsed.uiScale as number)
        : DEFAULTS.uiScale,
    }
  } catch {
    // Storage unavailable or unparseable: use the defaults.
    return DEFAULTS
  }
}

/** A stored value only wins if this build knows what it means. */
function valid<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** Writes the whole document, so no setter can erase another's value. */
function save(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...prefs }))
  } catch {
    // Failing to persist is not an error.
  }
}

interface PreferencesState extends Preferences {
  setDistanceUnit(unit: DistanceUnit): void
  setSpeedUnit(unit: SpeedUnit): void
  setVerticalSpeedUnit(unit: VerticalSpeedUnit): void
  setPlanFor(cls: VehicleClass): void
  setUiScale(scale: number): void
  /** Restores the defaults. */
  reset(): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...load(),

  setDistanceUnit(distance) {
    set({ units: { ...get().units, distance } })
    save(get())
  },

  setSpeedUnit(speed) {
    set({ units: { ...get().units, speed } })
    save(get())
  },

  setVerticalSpeedUnit(verticalSpeed) {
    set({ units: { ...get().units, verticalSpeed } })
    save(get())
  },

  setPlanFor(planFor) {
    set({ planFor })
    save(get())
  },

  setUiScale(scale) {
    if (!(UI_SCALES as readonly number[]).includes(scale)) return
    set({ uiScale: scale })
    save(get())
  },

  reset() {
    set({ ...DEFAULTS })
    save(DEFAULTS)
  },
}))

/** The unit choices, selected so components re-render only when units change. */
export const useUnits = (): UnitPrefs => usePreferencesStore((s) => s.units)
