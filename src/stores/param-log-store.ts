import { create } from 'zustand'

// A session-long narration of every parameter change made anywhere in the
// app -- the Parameters screen's own record of what a person did, not what
// the vehicle answered. It hooks the two places param-store guarantees every
// change passes through regardless of which screen made it: `edit` (every
// stage, from every ParamField, switch and curated card) and `confirmWrite`
// (every successful write, immediate or from the action bar's Write). This
// store only narrates; param-store remains the one place a value actually
// changes.

export interface ParamLogLine {
  id: string
  param: string
  from: number
  to: number
  status: 'pending' | 'committed'
  at: number
}

interface ParamLogState {
  lines: ParamLogLine[]
  /**
   * The still-pending line for a param currently being staged, so retyping
   * the same field updates its one line instead of adding a new one on
   * every keystroke. Cleared once that line commits or is cancelled.
   */
  open: Map<string, string>
  /** A field was staged (or its staged value changed) away from `from`. */
  recordEdit: (param: string, from: number, to: number) => void
  /** A field's staged edit was abandoned -- reverted back to its own value. */
  cancel: (param: string) => void
  /** A field was written and the vehicle echoed the value back. */
  recordCommit: (param: string, value: number) => void
  reset: () => void
}

// A long session can restage the same handful of parameters many times over
// (a bench tune nudging MOT_SPIN_MIN repeatedly); this is a scrollback, not
// an unbounded record.
const CAP = 300

export const useParamLogStore = create<ParamLogState>((set, get) => ({
  lines: [],
  open: new Map(),

  recordEdit: (param, from, to) => {
    const { lines, open } = get()
    const openId = open.get(param)
    // Typed back to the value the vehicle already has: not a change anymore,
    // so the pending line that promised one is withdrawn rather than left
    // reading a "from" and "to" that no longer describe what Write would do.
    if (from === to) {
      if (!openId) return
      const nextOpen = new Map(open)
      nextOpen.delete(param)
      set({ lines: lines.filter((l) => l.id !== openId), open: nextOpen })
      return
    }
    if (openId) {
      set({ lines: lines.map((l) => (l.id === openId ? { ...l, to, at: Date.now() } : l)) })
      return
    }
    const id = `${param}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const nextOpen = new Map(open)
    nextOpen.set(param, id)
    set({
      lines: [
        ...lines.slice(-(CAP - 1)),
        { id, param, from, to, status: 'pending', at: Date.now() },
      ],
      open: nextOpen,
    })
  },

  cancel: (param) => {
    const { lines, open } = get()
    const id = open.get(param)
    if (!id) return
    const nextOpen = new Map(open)
    nextOpen.delete(param)
    set({ lines: lines.filter((l) => l.id !== id), open: nextOpen })
  },

  recordCommit: (param, value) => {
    const { lines, open } = get()
    const id = open.get(param)
    if (!id) return
    const nextOpen = new Map(open)
    nextOpen.delete(param)
    set({
      lines: lines.map((l) =>
        l.id === id ? { ...l, to: value, status: 'committed', at: Date.now() } : l,
      ),
      open: nextOpen,
    })
  },

  reset: () => set({ lines: [], open: new Map() }),
}))
