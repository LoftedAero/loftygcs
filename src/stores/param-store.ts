import { create } from 'zustand'
import type { ParamRecord } from '../protocol/types'
import type { ParamMeta } from '../services/param-metadata'

// The full parameter table. Edits stage locally as dirty until an explicit
// Write sends them, since every write changes a vehicle's configuration.

export interface ParamEntry {
  value: number
  /** What the vehicle last confirmed. */
  origValue: number
  mavType: number
  dirty: boolean
}

export type ParamLoadState = 'idle' | 'downloading' | 'ready' | 'error'

interface ParamState {
  entries: Map<string, ParamEntry>
  order: string[]
  loadState: ParamLoadState
  /** Where the set on screen came from. A file is never written to a vehicle. */
  source: 'vehicle' | 'file' | null
  /** The file's name, when `source` is 'file'. */
  fileName: string | null
  progress: { got: number; total: number; source: 'ftp' | 'stream' } | null
  error: string | null
  dirtyCount: number
  writeBusy: boolean
  metadata: Record<string, ParamMeta>
  /**
   * Which metadata is loaded, "4.5.7" or "latest release". Shown because a
   * version mismatch is the usual reason a parameter has no documentation.
   */
  metadataSource: string | null
  lastWrite: { written: string[]; failed: string[] } | null

  beginDownload: () => void
  setProgress: (p: { got: number; total: number; source: 'ftp' | 'stream' }) => void
  loaded: (records: ParamRecord[]) => void
  loadedFile: (records: ParamRecord[], fileName: string) => void
  merged: (records: ParamRecord[]) => void
  failed: (error: string) => void
  edit: (name: string, value: number) => void
  revertAll: () => void
  confirmWrite: (name: string, value: number) => void
  setWriteBusy: (b: boolean) => void
  setMetadata: (m: Record<string, ParamMeta>, source?: string | null) => void
  setLastWrite: (r: { written: string[]; failed: string[] } | null) => void
  reset: () => void
}

function recount(entries: Map<string, ParamEntry>): number {
  let n = 0
  for (const e of entries.values()) if (e.dirty) n++
  return n
}

// Parameters travel as float32, so 13.2 arrives as 13.19999980926514.
// Normalize to 7 significant digits (float32's real precision) so the UI
// shows what the user will reason about; integers pass through untouched.
function tidy(v: number): number {
  return Number.isInteger(v) ? v : Number.parseFloat(v.toPrecision(7))
}

export const useParamStore = create<ParamState>((set, get) => ({
  entries: new Map(),
  order: [],
  loadState: 'idle',
  source: null,
  fileName: null,
  progress: null,
  error: null,
  dirtyCount: 0,
  writeBusy: false,
  metadata: {},
  metadataSource: null,
  lastWrite: null,

  beginDownload: () => set({ loadState: 'downloading', progress: null, error: null }),
  setProgress: (progress) => set({ progress }),
  loaded: (records) => {
    const entries = new Map<string, ParamEntry>()
    const order: string[] = []
    for (const r of records) {
      const value = tidy(r.value)
      entries.set(r.name, { value, origValue: value, mavType: r.mavType, dirty: false })
      order.push(r.name)
    }
    order.sort()
    set({
      entries,
      order,
      loadState: 'ready',
      progress: null,
      dirtyCount: 0,
      source: 'vehicle',
      fileName: null,
    })
  },
  /**
   * A parameter file opened with nothing connected (Mission Planner's
   * offline mode). Marked as a file so nothing offers to write it.
   */
  loadedFile: (records, fileName) => {
    const entries = new Map<string, ParamEntry>()
    const order: string[] = []
    for (const r of records) {
      const value = tidy(r.value)
      entries.set(r.name, { value, origValue: value, mavType: r.mavType, dirty: false })
      order.push(r.name)
    }
    set({
      entries,
      order,
      loadState: 'ready',
      progress: null,
      dirtyCount: 0,
      source: 'file',
      fileName,
    })
  },
  /**
   * A later download folded into the set already on screen.
   *
   * Unlike `loaded`, it leaves `loadState` alone (so curated tabs do not
   * blank) and keeps staged edits: a dirty entry keeps its staged value and
   * only updates the vehicle value it is staged against, so an edit the
   * vehicle has caught up with stops being dirty.
   */
  merged: (records) => {
    const prev = get().entries
    const entries = new Map<string, ParamEntry>()
    const order: string[] = []
    for (const r of records) {
      const value = tidy(r.value)
      const was = prev.get(r.name)
      if (was?.dirty) {
        entries.set(r.name, { ...was, origValue: value, dirty: was.value !== value })
      } else {
        entries.set(r.name, { value, origValue: value, mavType: r.mavType, dirty: false })
      }
      order.push(r.name)
    }
    // Clear progress, or the app bar's indicator keeps running after a quiet
    // refresh.
    set({ entries, order, dirtyCount: recount(entries), progress: null })
  },
  failed: (error) => set({ loadState: 'error', error }),

  edit: (name, value) => {
    const entries = new Map(get().entries)
    const e = entries.get(name)
    if (!e) return
    entries.set(name, { ...e, value, dirty: value !== e.origValue })
    set({ entries, dirtyCount: recount(entries) })
  },

  revertAll: () => {
    const entries = new Map(get().entries)
    for (const [name, e] of entries) {
      if (e.dirty) entries.set(name, { ...e, value: e.origValue, dirty: false })
    }
    set({ entries, dirtyCount: 0 })
  },

  confirmWrite: (name, value) => {
    const entries = new Map(get().entries)
    const e = entries.get(name)
    if (!e) return
    const v = tidy(value)
    entries.set(name, { ...e, value: v, origValue: v, dirty: false })
    set({ entries, dirtyCount: recount(entries) })
  },

  setWriteBusy: (writeBusy) => set({ writeBusy }),
  setMetadata: (metadata, source = null) => set({ metadata, metadataSource: source }),
  setLastWrite: (lastWrite) => set({ lastWrite }),
  reset: () =>
    set({
      entries: new Map(),
      order: [],
      loadState: 'idle',
      source: null,
      fileName: null,
      progress: null,
      error: null,
      dirtyCount: 0,
      writeBusy: false,
      lastWrite: null,
    }),
}))
