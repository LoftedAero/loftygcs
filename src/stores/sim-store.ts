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
}

const LOG_CAP = 200

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
  appendLog: (chunk) =>
    set((s) => ({
      log: [...s.log, ...chunk.split(/\r?\n/).filter(Boolean)].slice(-LOG_CAP),
    })),
}))
