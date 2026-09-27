import { create } from 'zustand'
import type { SimBuildChoice, SimParams, SimPhysics, SimStatus } from '../types/loftgcs'

// State of the locally managed ArduPilot SITL. Only meaningful in the
// desktop build; the browser has no way to run a process.

export type SimPhase = 'idle' | 'installing' | 'starting' | 'running' | 'error'

interface SimState {
  status: SimStatus | null
  phase: SimPhase
  progress: { file: string; done: number; total: number } | null
  error: string | null
  log: string[]
  setStatus: (s: SimStatus) => void
  setPhase: (p: SimPhase) => void
  setProgress: (p: SimState['progress']) => void
  fail: (error: string) => void
  /**
   * The simulator is up but RealFlight is not answering. Not an error: SITL
   * keeps retrying for as long as it runs.
   */
  waitingForRealFlight: boolean
  setWaitingForRealFlight: (waiting: boolean) => void
  appendLog: (chunk: string) => void
  /**
   * Where the next simulator boots, one remembered place per physics.
   *
   * A home chosen for RealFlight is measured against RealFlight's scenery
   * and means nothing to SITL's own model, so each physics keeps its own.
   *
   * An empty slot means that physics' default (CMAC or Eli Field), which is
   * never written in as if chosen.
   */
  homes: Record<HomeSlot, string>
  /** Writes the slot the current physics uses. */
  setHomeText: (text: string) => void

  /**
   * Where the next file dialog opens.
   *
   * One folder for both pickers: an aircraft ships as an executable beside
   * its `<model>/eeprom.bin`, so they are the same folder in practice.
   */
  browseDir: string
  setBrowseDir: (dir: string) => void

  /**
   * How the next simulator is launched. Remembered across sessions, since
   * the same setup is usually used every time.
   */
  build: SimBuildChoice | null
  setBuild: (build: SimBuildChoice | null) => void
  physics: SimPhysics
  setPhysics: (physics: SimPhysics) => void
  params: SimParams
  setParams: (params: SimParams) => void
}

const LOG_CAP = 200
// One remembered home per physics. With FlightAxis, ArduPilot sets its origin
// to home and maps RealFlight's local coordinates around it, so home decides
// both where the field sits on Earth and which way its runway points.
const HOME_KEY = 'loftgcs.sim.home'
const RIG_KEY = 'loftgcs.sim.rig'
const BROWSE_KEY = 'loftgcs.sim.browseDir'

/** Which remembered home a physics choice uses. */
export type HomeSlot = 'builtin' | 'flightaxis'

export function homeSlot(physicsKind: string): HomeSlot {
  return physicsKind === 'flightaxis' ? 'flightaxis' : 'builtin'
}

interface Rig {
  build: SimBuildChoice | null
  physics: SimPhysics
  params: SimParams
}

/**
 * The launch setup, remembered.
 *
 * The defaults: the managed download, its built-in physics, and a wipe.
 */
const DEFAULT_RIG: Rig = { build: null, physics: { kind: 'builtin' }, params: { kind: 'wipe' } }

function loadRig(): Rig {
  try {
    const raw = localStorage.getItem(RIG_KEY)
    if (!raw) return DEFAULT_RIG
    const parsed = JSON.parse(raw) as Partial<Rig>
    return {
      build: parsed.build ?? null,
      physics: parsed.physics ?? DEFAULT_RIG.physics,
      params: parsed.params ?? DEFAULT_RIG.params,
    }
  } catch {
    return DEFAULT_RIG
  }
}

function saveRig(rig: Rig): void {
  try {
    localStorage.setItem(RIG_KEY, JSON.stringify(rig))
  } catch {
    // Failing to persist is not an error.
  }
}

const NO_HOMES: Record<HomeSlot, string> = { builtin: '', flightaxis: '' }

/**
 * Homes are stored as the text chosen (altitude and heading included), not
 * parsed, so they survive a build that parses differently.
 *
 * A legacy bare string is migrated into the slot for the physics the saved
 * rig has selected, not assumed to be `builtin`.
 */
function loadHomes(): Record<HomeSlot, string> {
  try {
    const raw = localStorage.getItem(HOME_KEY)
    if (!raw) return NO_HOMES
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as Partial<Record<HomeSlot, string>>
      return {
        builtin: typeof parsed.builtin === 'string' ? parsed.builtin : '',
        flightaxis: typeof parsed.flightaxis === 'string' ? parsed.flightaxis : '',
      }
    }
    return { ...NO_HOMES, [homeSlot(loadRig().physics.kind)]: raw }
  } catch {
    return NO_HOMES
  }
}

function saveHomes(homes: Record<HomeSlot, string>): void {
  try {
    localStorage.setItem(HOME_KEY, JSON.stringify(homes))
  } catch {
    // Failing to persist is not an error.
  }
}

/**
 * The home in force, given what is selected.
 *
 * Derived rather than stored, so it cannot go stale when physics changes.
 */
export function currentHomeText(s: Pick<SimState, 'homes' | 'physics'>): string {
  return s.homes[homeSlot(s.physics.kind)]
}

/** The same, as a hook. Returns a string, so it re-renders only on change. */
export const useHomeText = (): string => useSimStore(currentHomeText)

export const useSimStore = create<SimState>((set, get) => ({
  status: null,
  phase: 'idle',
  progress: null,
  error: null,
  waitingForRealFlight: false,
  setWaitingForRealFlight: (waitingForRealFlight) => set({ waitingForRealFlight }),
  log: [],
  setStatus: (status) => set({ status }),
  setPhase: (phase) =>
    set({
      phase,
      ...(phase === 'idle' ? { error: null, waitingForRealFlight: false } : {}),
    }),
  setProgress: (progress) => set({ progress }),
  fail: (error) => set({ phase: 'error', error }),
  ...loadRig(),
  setBuild: (build) => {
    set({ build })
    saveRig({ build, physics: get().physics, params: get().params })
  },
  setPhysics: (physics) => {
    set({ physics })
    saveRig({ build: get().build, physics, params: get().params })
  },
  setParams: (params) => {
    set({ params })
    saveRig({ build: get().build, physics: get().physics, params })
  },

  browseDir: (() => {
    try {
      return localStorage.getItem(BROWSE_KEY) ?? ''
    } catch {
      return ''
    }
  })(),
  setBrowseDir: (browseDir) => {
    set({ browseDir })
    try {
      localStorage.setItem(BROWSE_KEY, browseDir)
    } catch {
      // Failing to persist is not an error.
    }
  },

  homes: loadHomes(),
  setHomeText: (text) => {
    const homes = { ...get().homes, [homeSlot(get().physics.kind)]: text }
    set({ homes })
    saveHomes(homes)
  },
  appendLog: (chunk) =>
    set((s) => ({
      log: [...s.log, ...chunk.split(/\r?\n/).filter(Boolean)].slice(-LOG_CAP),
    })),
}))
