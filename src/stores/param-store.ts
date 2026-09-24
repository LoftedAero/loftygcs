import { create } from 'zustand'
import type { ParamRecord } from '../protocol/types'
import type { ParamMeta } from '../services/param-metadata'
import { useParamLogStore } from './param-log-store'

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
  /**
   * Where the set on screen came from.
   *
   * A file is not an aircraft. Everything that writes has to know the
   * difference, and so does the person reading the table -- editing a saved
   * configuration and editing the thing in front of you look identical
   * otherwise.
   */
  source: 'vehicle' | 'file' | null
  /** The file's name, when `source` is 'file'. */
  fileName: string | null
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
   * A second download folded into the set already on screen.
   *
   * `loaded` is for the first one and rebuilds everything, which is wrong
   * for a refresh in two ways: it flips `loadState`, blanking every curated
   * tab while it runs, and it throws away staged edits -- a background
   * refresh that silently discarded someone's unwritten changes would be a
   * far worse bug than the one it was added to fix.
   *
   * So a dirty entry keeps the value it is staged at, and only learns what
   * the vehicle now says it is staged *against*: if the vehicle has caught
   * up to the staged value, the edit is no longer an edit.
   */
  /**
   * A parameter file opened with nothing connected.
   *
   * Mission Planner has had this for years and it is the one thing its
   * disconnected Config screen keeps: open a saved set, read it, compare it,
   * edit it, save it again. Marked as a file so nothing offers to write it
   * to an aircraft that is not there.
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
    // Progress is cleared here as well as in `loaded`, or the app bar's
    // parameter bar would be left running after a quiet refresh finished.
    set({ entries, order, dirtyCount: recount(entries), progress: null })
  },
  failed: (error) => set({ loadState: 'error', error }),

  edit: (name, value) => {
    const entries = new Map(get().entries)
    const e = entries.get(name)
    if (!e) return
    entries.set(name, { ...e, value, dirty: value !== e.origValue })
    set({ entries, dirtyCount: recount(entries) })
    // The Parameters screen's change log, narrating from the same value
    // this entry is staged against -- so retyping the same field keeps
    // reporting against where the vehicle actually stands.
    useParamLogStore.getState().recordEdit(name, e.origValue, value)
  },

  revertAll: () => {
    const entries = new Map(get().entries)
    for (const [name, e] of entries) {
      if (e.dirty) {
        entries.set(name, { ...e, value: e.origValue, dirty: false })
        useParamLogStore.getState().cancel(name)
      }
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
    useParamLogStore.getState().recordCommit(name, v)
  },

  setWriteBusy: (writeBusy) => set({ writeBusy }),
  setMetadata: (metadata, source = null) => set({ metadata, metadataSource: source }),
  setLastWrite: (lastWrite) => set({ lastWrite }),
  reset: () => {
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
    })
    // A new connection is a new session for the change log too -- the same
    // moment vehicle-store forgets the last aircraft's status feed.
    useParamLogStore.getState().reset()
  },
}))
