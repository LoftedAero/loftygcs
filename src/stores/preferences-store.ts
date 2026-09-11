import { create } from 'zustand'
import type { VehicleClass } from '../protocol/modes'
import {
  DEFAULT_UNITS,
  type DistanceUnit,
  type SpeedUnit,
  type UnitPrefs,
  type VerticalSpeedUnit,
} from '../units'

// What the person using the app has chosen, as opposed to what the aircraft
// is doing. Units today; language and whatever comes after it belong here
// too, which is why this is one versioned document rather than a key per
// setting.
//
// The shape is deliberately additive: unknown keys in storage are ignored
// and missing ones fall back to the default, so a build that adds a
// preference reads an older browser's settings without a migration, and an
// older build reading a newer store keeps working. Only a change that
// *reinterprets* an existing key needs VERSION bumped.
//
// Theme stays in theme-store: it has to be applied to the document before
// first paint by an inline script in index.html, which is a different
// lifetime from everything here. The preferences dialog edits it through
// that store rather than duplicating it.

const STORAGE_KEY = 'loftgcs.preferences'
const VERSION = 1

export interface Preferences {
  units: UnitPrefs
  /**
   * What to plan for when no vehicle is connected.
   *
   * A mission's command set depends on the aircraft -- spline waypoints and
   * payload place are Copter-only and a fixed wing refuses them on upload --
   * so planning offline has to assume something. QGroundControl asks the
   * same question (`offlineEditingVehicleClass`) and its docs say why: "when
   * planning offline you must set them before adding any mission items so
   * that the correct mission commands are available." Mission Planner does
   * not ask, always assumes Copter, and has an open issue about it.
   *
   * It is a preference rather than plan state because it is a property of
   * the person, not of the plan: someone who flies a plane wants plane
   * commands every time they open the app.
   */
  planFor: VehicleClass
}

const DEFAULTS: Preferences = {
  units: DEFAULT_UNITS,
  // Copter is the commonest ArduPilot vehicle and the one whose command set
  // is a superset, so a wrong default costs an unused menu entry rather than
  // a missing one.
  planFor: 'copter',
}

/** Read what is stored, keeping anything this build does not recognize. */
function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as {
      version?: number
      units?: Partial<UnitPrefs>
      planFor?: string
    }
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS
    return {
      units: {
        distance: valid(parsed.units?.distance, ['m', 'ft'], DEFAULTS.units.distance),
        speed: valid(parsed.units?.speed, ['ms', 'kmh', 'kts', 'mph'], DEFAULTS.units.speed),
        // Absent in anything written before the control existed, and the
        // fallback is `follow` -- which is exactly what those builds did.
        // So this needed no VERSION bump: nothing is reinterpreted.
        verticalSpeed: valid(
          parsed.units?.verticalSpeed,
          ['follow', 'ms', 'fpm'],
          DEFAULTS.units.verticalSpeed,
        ),
      },
      // Absent in anything written before this existed, and the fallback is
      // the whole catalog, which is what those builds offered. No VERSION
      // bump: nothing is reinterpreted.
      planFor: valid(parsed.planFor, ['copter', 'plane', 'rover', 'other'], DEFAULTS.planFor),
    }
  } catch {
    // Private mode, disabled storage, or something else's key at ours: the
    // defaults are a fine answer and never a reason to fail to start.
    return DEFAULTS
  }
}

/** A stored value only wins if this build knows what it means. */
function valid<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * The whole document, every time.
 *
 * Each setter used to write only its own slice, which was fine while there
 * was one; a second preference would have had every units setter erase it.
 */
function save(prefs: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...prefs }))
  } catch {
    // Not remembering a preference is a nuisance, never a failure.
  }
}

interface PreferencesState extends Preferences {
  setDistanceUnit(unit: DistanceUnit): void
  setSpeedUnit(unit: SpeedUnit): void
  setVerticalSpeedUnit(unit: VerticalSpeedUnit): void
  setPlanFor(cls: VehicleClass): void
  /** Back to the shipped defaults, for a dialog that offers it. */
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

  reset() {
    set({ ...DEFAULTS })
    save(DEFAULTS)
  },
}))

/**
 * The unit choices, for the many components that only read them.
 *
 * A selector rather than the whole store, so a component re-renders when
 * units change and not when some future preference does.
 */
export const useUnits = (): UnitPrefs => usePreferencesStore((s) => s.units)
