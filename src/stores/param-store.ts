import { create } from 'zustand'
import type { ParamRecord } from '../protocol/types'
import type { ParamMeta } from '../services/param-metadata'

// The full parameter table. Edits stage locally as "dirty" until the
// action-bar Write sends them -- the same save-explicitly idiom as the other
// Lofted Aero apps, because every write here moves configuration on a
// vehicle.

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
  progress: { got: number; total: number; source: 'ftp' | 'stream' } | null
  error: string | null
  dirtyCount: number
  writeBusy: boolean
  metadata: Record<string, ParamMeta>
  /**
   * Which metadata is loaded -- "4.5.7" or "latest release".
   *
   * Worth showing: parameters that exist in one firmware and not another
   * are the usual reason a hint is missing, and a station that quietly used
   * the wrong version's documentation would be lying rather than silent.
   */
  metadataSource: string | null
  lastWrite: { written: number; failed: string[] } | null

  beginDownload: () => void
  setProgress: (p: { got: number; total: number; source: 'ftp' | 'stream' }) => void
  loaded: (records: ParamRecord[]) => void
  failed: (error: string) => void
  edit: (name: string, value: number) => void
  revertAll: () => void
  confirmWrite: (name: string, value: number) => void
  setWriteBusy: (b: boolean) => void
  setMetadata: (m: Record<string, ParamMeta>, source?: string | null) => void
  setLastWrite: (r: { written: number; failed: string[] } | null) => void
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
    set({ entries, order, loadState: 'ready', progress: null, dirtyCount: 0 })
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
      progress: null,
      error: null,
      dirtyCount: 0,
      writeBusy: false,
      lastWrite: null,
    }),
}))
