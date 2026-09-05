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
  appendLog: (chunk: string) => void
  /** Where the next simulator boots, as typed. Empty means the default. */
  homeText: string
  setHomeText: (text: string) => void

  /**
   * How the next simulator is launched.
   *
   * Remembered across sessions, because this is a rig rather than a
   * setting: someone who flies a custom build against RealFlight does it
   * every time, and rebuilding the three choices at each launch is the
   * whole cost of the feature.
   */
  build: SimBuildChoice | null
  setBuild: (build: SimBuildChoice | null) => void
  physics: SimPhysics
  setPhysics: (physics: SimPhysics) => void
  params: SimParams
  setParams: (params: SimParams) => void
}

const LOG_CAP = 200
const HOME_KEY = 'loftgcs.sim.home'
const RIG_KEY = 'loftgcs.sim.rig'

interface Rig {
  build: SimBuildChoice | null
  physics: SimPhysics
  params: SimParams
}

/**
 * The launch setup, remembered.
 *
 * Defaults are what someone gets who just presses Start: the managed
 * download, its own physics, and a wipe -- the behavior before any of this
 * was choosable.
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
    // Not remembering the rig is a nuisance, never a failure.
  }
}

/**
 * The home text is remembered rather than the parsed location: what the
 * user typed is what they want to see when they come back, including the
 * altitude they left off.
 */
function loadHome(): string {
  try {
    return localStorage.getItem(HOME_KEY) ?? ''
  } catch {
    return ''
  }
}

export const useSimStore = create<SimState>((set, get) => ({
  status: null,
  phase: 'idle',
  progress: null,
  error: null,
  log: [],
  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase, ...(phase === 'idle' ? { error: null } : {}) }),
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

  homeText: loadHome(),
  setHomeText: (homeText) => {
    set({ homeText })
    try {
      localStorage.setItem(HOME_KEY, homeText)
    } catch {
      // Not remembering the field is a nuisance, never a failure.
    }
  },
  appendLog: (chunk) =>
    set((s) => ({
      log: [...s.log, ...chunk.split(/\r?\n/).filter(Boolean)].slice(-LOG_CAP),
    })),
}))
