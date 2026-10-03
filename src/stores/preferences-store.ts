import { create } from 'zustand'
import type { VehicleClass } from '../protocol/modes'
import {
  DEFAULT_REPEAT_S,
  REPEAT_CHOICES_S,
  calloutDef,
  isCalloutId,
  modesOf,
  type CalloutId,
  type CalloutMode,
} from '../services/voice/catalog'
import { DEFAULT_TONES, TONE_IDS, type ToneChoice } from '../services/voice/tones'
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
  /**
   * The desktop or compact layout (src/ui/compact.ts), or `auto` to choose by
   * window size.
   */
  layout: LayoutChoice
  voice: VoicePrefs
}

/**
 * Voice callouts and beeps (services/voice). Only the rows the user changed
 * are stored; the catalog holds every default, so a new callout needs no
 * migration.
 */
export interface VoicePrefs {
  /** The master switch: no speech and no beeps when off. */
  enabled: boolean
  modes: Partial<Record<CalloutId, CalloutMode>>
  /** Thresholds, in the catalog's units (SI for distance and speed). */
  values: Partial<Record<CalloutId, number>>
  /** How often an alert that is still true is said again, in seconds; 0 never. */
  repeatS: number
  tones: ToneChoice
}

export const DEFAULT_VOICE: VoicePrefs = {
  enabled: true,
  modes: {},
  values: {},
  repeatS: DEFAULT_REPEAT_S,
  tones: DEFAULT_TONES,
}

export type LayoutChoice = 'auto' | 'desktop' | 'compact'

/** The scales offered. */
export const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.5] as const

const DEFAULTS: Preferences = {
  units: DEFAULT_UNITS,
  // Copter's command set is a superset, so a wrong default adds an unused
  // entry rather than hiding one.
  planFor: 'copter',
  uiScale: 1,
  layout: 'auto',
  voice: DEFAULT_VOICE,
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
      layout?: string
      voice?: unknown
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
      layout: valid(parsed.layout, ['auto', 'desktop', 'compact'], DEFAULTS.layout),
      voice: loadVoice(parsed.voice),
    }
  } catch {
    // Storage unavailable or unparseable: use the defaults.
    return DEFAULTS
  }
}

/** Keeps only the rows and values this build knows, within each row's range. */
export function loadVoice(raw: unknown): VoicePrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VOICE
  const v = raw as Record<string, unknown>
  const modes: VoicePrefs['modes'] = {}
  const values: VoicePrefs['values'] = {}
  if (typeof v.modes === 'object' && v.modes !== null) {
    for (const [id, mode] of Object.entries(v.modes)) {
      if (!isCalloutId(id)) continue
      if (modesOf(calloutDef(id)).includes(mode as CalloutMode)) modes[id] = mode as CalloutMode
    }
  }
  if (typeof v.values === 'object' && v.values !== null) {
    for (const [id, value] of Object.entries(v.values)) {
      if (!isCalloutId(id)) continue
      const t = calloutDef(id).threshold
      if (t && typeof value === 'number' && value >= t.min && value <= t.max) values[id] = value
    }
  }
  const tones = (typeof v.tones === 'object' && v.tones !== null ? v.tones : {}) as Record<
    string,
    unknown
  >
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_VOICE.enabled,
    modes,
    values,
    repeatS: (REPEAT_CHOICES_S as readonly number[]).includes(v.repeatS as number)
      ? (v.repeatS as number)
      : DEFAULT_VOICE.repeatS,
    tones: {
      info: valid(tones.info, TONE_IDS.info, DEFAULT_TONES.info),
      warn: valid(tones.warn, TONE_IDS.warn, DEFAULT_TONES.warn),
    },
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
  setLayout(layout: LayoutChoice): void
  setVoiceEnabled(enabled: boolean): void
  /** Sets one row's mode; the default is stored as no entry. */
  setCalloutMode(id: CalloutId, mode: CalloutMode): void
  setCalloutValue(id: CalloutId, value: number): void
  setRepeatS(seconds: number): void
  setTone(kind: keyof ToneChoice, id: string): void
  /** Puts every callout row back to its default, keeping the master switch. */
  resetCallouts(): void
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

  setLayout(layout) {
    set({ layout })
    save(get())
  },

  setVoiceEnabled(enabled) {
    set({ voice: { ...get().voice, enabled } })
    save(get())
  },

  setCalloutMode(id, mode) {
    const modes = { ...get().voice.modes }
    if (mode === calloutDef(id).mode) delete modes[id]
    else modes[id] = mode
    set({ voice: { ...get().voice, modes } })
    save(get())
  },

  setCalloutValue(id, value) {
    const t = calloutDef(id).threshold
    if (!t || !Number.isFinite(value)) return
    const values = { ...get().voice.values }
    const v = Math.min(t.max, Math.max(t.min, value))
    if (v === t.default) delete values[id]
    else values[id] = v
    set({ voice: { ...get().voice, values } })
    save(get())
  },

  setRepeatS(repeatS) {
    if (!(REPEAT_CHOICES_S as readonly number[]).includes(repeatS)) return
    set({ voice: { ...get().voice, repeatS } })
    save(get())
  },

  setTone(kind, id) {
    if (!(TONE_IDS[kind] as readonly string[]).includes(id)) return
    set({ voice: { ...get().voice, tones: { ...get().voice.tones, [kind]: id } } })
    save(get())
  },

  resetCallouts() {
    set({ voice: { ...DEFAULT_VOICE, enabled: get().voice.enabled } })
    save(get())
  },

  reset() {
    set({ ...DEFAULTS })
    save(DEFAULTS)
  },
}))

/** A row's effective mode: the user's, else the catalog's. */
export function calloutMode(voice: VoicePrefs, id: CalloutId): CalloutMode {
  return voice.modes[id] ?? calloutDef(id).mode
}

/** A row's effective threshold, in the catalog's units. */
export function calloutValue(voice: VoicePrefs, id: CalloutId): number {
  return voice.values[id] ?? calloutDef(id).threshold?.default ?? 0
}

/** The unit choices, selected so components re-render only when units change. */
export const useUnits = (): UnitPrefs => usePreferencesStore((s) => s.units)
