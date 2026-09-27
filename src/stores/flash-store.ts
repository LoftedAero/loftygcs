import { create } from 'zustand'
import type { ApjFirmware } from '../protocol/bootloader/apj'
import type { HexSegment } from '../protocol/bootloader/intel-hex'

// Firmware-flashing state: what image is staged, and how the running flash
// is going. One flash at a time, by construction.

export type LoadedFirmware =
  | { kind: 'apj'; apj: ApjFirmware; label: string }
  | { kind: 'hex'; segments: HexSegment[]; label: string }

/**
 * One slot per image kind: the serial bootloader takes an `.apj` and DFU
 * takes the `_with_bl.hex`, and loading one must not evict the other.
 */
export type LoadedApj = Extract<LoadedFirmware, { kind: 'apj' }>
export type LoadedHex = Extract<LoadedFirmware, { kind: 'hex' }>

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

/**
 * Which path the running flash is on, so only that path's panel shows the
 * shared progress and log.
 */
export type FlashPath = 'serial' | 'dfu'

interface FlashState {
  apj: LoadedApj | null
  hex: LoadedHex | null
  path: FlashPath | null
  phase: FlashPhaseUi
  progress: number
  log: string[]
  error: string | null
  setFirmware: (fw: LoadedFirmware | null) => void
  begin: (path: FlashPath) => void
  setPhase: (p: FlashPhaseUi) => void
  setProgress: (pct: number) => void
  appendLog: (line: string) => void
  fail: (error: string) => void
  finish: () => void
}

const LOG_CAP = 300

export const useFlashStore = create<FlashState>((set) => ({
  apj: null,
  hex: null,
  path: null,
  phase: 'idle',
  progress: 0,
  log: [],
  error: null,
  // Null clears both slots.
  setFirmware: (fw) =>
    set(
      fw === null
        ? { apj: null, hex: null, phase: 'idle', progress: 0, error: null }
        : fw.kind === 'apj'
          ? { apj: fw, phase: 'idle', progress: 0, error: null }
          : { hex: fw, phase: 'idle', progress: 0, error: null },
    ),
  begin: (path) => set({ path, phase: 'sync', progress: 0, log: [], error: null }),
  setPhase: (phase) => set({ phase, progress: 0 }),
  setProgress: (progress) => set({ progress }),
  appendLog: (line) => set((s) => ({ log: [...s.log.slice(-(LOG_CAP - 1)), line] })),
  fail: (error) => set({ phase: 'error', error }),
  finish: () => set({ phase: 'done', progress: 100 }),
}))
