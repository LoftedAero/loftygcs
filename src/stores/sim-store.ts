import { create } from 'zustand'
import type { SimStatus } from '../types/loftgcs'

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
}

const LOG_CAP = 200
const HOME_KEY = 'loftgcs.sim.home'

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

export const useSimStore = create<SimState>((set) => ({
  status: null,
  phase: 'idle',
  progress: null,
  error: null,
  log: [],
  setStatus: (status) => set({ status }),
  setPhase: (phase) => set({ phase, ...(phase === 'idle' ? { error: null } : {}) }),
  setProgress: (progress) => set({ progress }),
  fail: (error) => set({ phase: 'error', error }),
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
