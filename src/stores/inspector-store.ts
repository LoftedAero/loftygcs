import { create } from 'zustand'
import type { InspectorRow } from '../protocol/types'

// The inspector's snapshot of the link.
//
// The only place link traffic reaches React state, and only as a condensed
// snapshot the worker sends every 400 ms, so the store updates at 2.5 Hz
// regardless of link rate.

interface InspectorState {
  rows: InspectorRow[]
  /** Which (sysid:compid:msgid) row the detail pane is showing. */
  selectedKey: string | null
  /** Frozen for reading; snapshots keep arriving and are dropped. */
  paused: boolean
  filter: string
  applyRows(rows: InspectorRow[]): void
  select(key: string | null): void
  setPaused(paused: boolean): void
  setFilter(filter: string): void
  clear(): void
}

export const rowKey = (r: { sysid: number; compid: number; msgid: number }) =>
  `${r.sysid}:${r.compid}:${r.msgid}`

export const useInspectorStore = create<InspectorState>((set, get) => ({
  rows: [],
  selectedKey: null,
  paused: false,
  filter: '',
  applyRows(rows) {
    if (get().paused) return
    set({ rows })
  },
  select(selectedKey) {
    set({ selectedKey })
  },
  setPaused(paused) {
    set({ paused })
  },
  setFilter(filter) {
    set({ filter })
  },
  clear() {
    set({ rows: [], selectedKey: null, paused: false })
  },
}))
