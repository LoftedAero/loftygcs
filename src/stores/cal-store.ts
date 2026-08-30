import { create } from 'zustand'

// Calibration wizard state, fed by the connection service from protocol
// events. Wizards render from here; they act through connectionService.

export interface MagCalState {
  running: boolean
  pct: number
  calStatus: number
  report: { calStatus: number; fitness: number; autosaved: number } | null
}

interface CalState {
  magCal: MagCalState
  magCalStarted: () => void
  magCalProgress: (pct: number, calStatus: number) => void
  magCalReport: (report: MagCalState['report']) => void
  magCalReset: () => void
}

const MAG_IDLE: MagCalState = { running: false, pct: 0, calStatus: 0, report: null }

export const useCalStore = create<CalState>((set) => ({
  magCal: MAG_IDLE,
  magCalStarted: () => set({ magCal: { ...MAG_IDLE, running: true } }),
  magCalProgress: (pct, calStatus) =>
    set((s) => ({ magCal: { ...s.magCal, running: true, pct, calStatus } })),
  magCalReport: (report) => set((s) => ({ magCal: { ...s.magCal, running: false, report } })),
  magCalReset: () => set({ magCal: MAG_IDLE }),
}))
