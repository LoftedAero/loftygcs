import { create } from 'zustand'
import type { ApjFirmware } from '../protocol/bootloader/apj'
import type { HexSegment } from '../protocol/bootloader/intel-hex'

// Firmware-flashing state: what image is staged, and how the running flash
// is going. One flash at a time, by construction.

export type LoadedFirmware =
  | { kind: 'apj'; apj: ApjFirmware; label: string }
  | { kind: 'hex'; segments: HexSegment[]; label: string }

export type FlashPhaseUi =
  | 'idle'
  | 'sync'
  | 'erase'
  | 'program'
  | 'verify'
  | 'reboot'
  | 'leave'
  | 'done'
  | 'error'

interface FlashState {
  firmware: LoadedFirmware | null
  phase: FlashPhaseUi
  progress: number
  log: string[]
  error: string | null
  setFirmware: (fw: LoadedFirmware | null) => void
  begin: () => void
  setPhase: (p: FlashPhaseUi) => void
  setProgress: (pct: number) => void
  appendLog: (line: string) => void
  fail: (error: string) => void
  finish: () => void
}

const LOG_CAP = 300

export const useFlashStore = create<FlashState>((set) => ({
  firmware: null,
  phase: 'idle',
  progress: 0,
  log: [],
  error: null,
  setFirmware: (firmware) => set({ firmware, phase: 'idle', progress: 0, error: null }),
  begin: () => set({ phase: 'sync', progress: 0, log: [], error: null }),
  setPhase: (phase) => set({ phase, progress: 0 }),
  setProgress: (progress) => set({ progress }),
  appendLog: (line) => set((s) => ({ log: [...s.log.slice(-(LOG_CAP - 1)), line] })),
  fail: (error) => set({ phase: 'error', error }),
  finish: () => set({ phase: 'done', progress: 100 }),
}))
