import { create } from 'zustand'
import { DEFAULT_UNITS, type DistanceUnit, type SpeedUnit, type UnitPrefs } from '../units'

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
}

const DEFAULTS: Preferences = {
  units: DEFAULT_UNITS,
}

/** Read what is stored, keeping anything this build does not recognize. */
function load(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as { version?: number; units?: Partial<UnitPrefs> }
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS
    return {
      units: {
        distance: valid(parsed.units?.distance, ['m', 'ft'], DEFAULTS.units.distance),
        speed: valid(parsed.units?.speed, ['ms', 'kmh', 'kts', 'mph'], DEFAULTS.units.speed),
      },
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
  /** Back to the shipped defaults, for a dialog that offers it. */
  reset(): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...load(),

  setDistanceUnit(distance) {
    const units = { ...get().units, distance }
    set({ units })
    save({ units })
  },

  setSpeedUnit(speed) {
    const units = { ...get().units, speed }
    set({ units })
    save({ units })
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
