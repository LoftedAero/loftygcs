import { create } from 'zustand'
import {
  fieldUnit,
  getSeries,
  parseDataflash,
  type ParsedLog,
  type Series,
} from '../protocol/dataflash'
import { evaluateExpression, expressionError } from '../protocol/log-expression'

// The log being reviewed, and what is being looked at in it.
//
// One log at a time, held whole in memory: a 10 MB flight parses in about
// 150 ms and the columnar tables are smaller than the file, so streaming is
// not worth the complexity.

/**
 * What occupies the upper half of the screen. The replay is always shown;
 * 'none' gives it the whole window, which is how a log opens.
 */
export type UpperPane = 'none' | 'plot' | 'table'

/** Fraction of the height given to the plot in the split view. */
const SPLIT_KEY = 'loftgcs.logs.split'

const PRESETS_KEY = 'loftgcs.logs.presets'

/**
 * Saved plot setups, kept per browser rather than per log, since they
 * belong to the person reviewing rather than to one flight.
 */
function loadPresets(): Record<string, SelectedField[]> {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SelectedField[]>) : {}
  } catch {
    return {}
  }
}

function savePresets(presets: Record<string, SelectedField[]>): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // Storage unavailable; presets just are not remembered.
  }
}

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY))
    if (Number.isFinite(v) && v > 0.15 && v < 0.85) return v
  } catch {
    // Storage blocked; use the default.
  }
  return 0.45
}

/** How many y axes the plot will draw at once. */
export const MAX_AXES = 4

/**
 * One trace on the plot: either a field, or an expression over fields. An
 * expression's source text doubles as its label.
 */
export interface SelectedField {
  message: string
  field: string
  /** Set when this trace is computed rather than read. */
  expression?: string
  /** Which y axis it is drawn against, 0-based. */
  axis: number
  /** Trace color. Unset means the default for its position in the list. */
  color?: string
}

/**
 * Default trace colors, in order.
 *
 * The design system's working colors first, then enough distinct hues to
 * tell eight traces apart.
 */
export const TRACE_COLORS = [
  '#F7941D',
  '#4684C5',
  '#2FAE4E',
  '#D63031',
  '#8E44AD',
  '#16A085',
  '#E67E22',
  '#2C3E50',
]

/** The color a field is drawn in: its own, or the default for its slot. */
export function traceColor(field: SelectedField, index: number): string {
  return field.color ?? TRACE_COLORS[index % TRACE_COLORS.length]!
}

/**
 * Which axis a newly plotted field should land on.
 *
 * Fields in the same unit share an axis, so Pitch added after Roll is
 * compared on one scale. A new unit takes the next free axis; once they run
 * out it joins the most crowded one, and the user can move it.
 */
export function defaultAxis(
  existing: readonly { axis: number; unit: string }[],
  unit: string,
): number {
  const sameUnit = existing.find((e) => e.unit === unit && unit !== '')
  if (sameUnit) return sameUnit.axis
  const used = new Set(existing.map((e) => e.axis))
  for (let i = 0; i < MAX_AXES; i++) if (!used.has(i)) return i
  const counts = new Map<number, number>()
  for (const e of existing) counts.set(e.axis, (counts.get(e.axis) ?? 0) + 1)
  let best = 0
  let most = -1
  for (const [axis, n] of counts) {
    if (n > most) {
      most = n
      best = axis
    }
  }
  return best
}

/** A log sitting on the vehicle's card. */
export interface VehicleLog {
  name: string
  path: string
  /** Bytes, as the directory listing reported them. */
  size: number
}

/** What the vehicle side of this screen is doing. */
export type VehicleLogStatus =
  | { kind: 'idle' }
  | { kind: 'listing' }
  | { kind: 'downloading'; name: string; got: number; total: number }
  | { kind: 'error'; text: string }

export type LogStatus =
  | { kind: 'empty' }
  | { kind: 'reading'; name: string; got: number; total: number }
  | { kind: 'parsing'; name: string }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; text: string }

interface LogState {
  log: ParsedLog | null
  /**
   * The file exactly as it arrived, so a log pulled off the vehicle can be
   * saved without fetching it again. The parsed tables cannot be turned back
   * into a .bin.
   */
  rawBytes: Uint8Array | null
  status: LogStatus
  upper: UpperPane
  /** Fields drawn on the plot, in the order they were added. */
  selected: SelectedField[]
  /** Which message the table is showing; null means pick one. */
  tableMessage: string | null
  /** Filter text for the field picker. */
  search: string
  /** Shade the plot behind the traces by flight mode. */
  shadeModes: boolean

  /** Logs found on the vehicle, newest first. */
  vehicleLogs: VehicleLog[]
  vehicleStatus: VehicleLogStatus
  setVehicleLogs(logs: VehicleLog[]): void
  setVehicleStatus(status: VehicleLogStatus): void

  setStatus(status: LogStatus): void
  loadBytes(name: string, bytes: Uint8Array): void
  clear(): void
  setUpper(pane: UpperPane): void
  /** Add or remove a field. The axis is chosen for it; see defaultAxis. */
  toggleField(field: { message: string; field: string }): void
  /** Plot a computed expression. Returns the problem, or null. */
  addExpression(source: string): string | null

  /** Saved plot setups, by name. */
  presets: Record<string, SelectedField[]>
  savePreset(name: string): void
  loadPreset(name: string): void
  deletePreset(name: string): void
  /** Move a plotted field to another axis. */
  setFieldAxis(field: { message: string; field: string }, axis: number): void
  /** Recolor a plotted field. */
  setFieldColor(field: { message: string; field: string }, color: string): void

  /**
   * The visible time window, or null for the whole log. In the store because
   * the per-field statistics, drawn elsewhere, cover what is on screen.
   */
  timeWindow: { t0: number; t1: number } | null
  setTimeWindow(window: { t0: number; t1: number } | null): void

  /**
   * Replay position in seconds since boot, or null when it is not running.
   * Shared so the plot can mark the same instant.
   */
  playhead: number | null
  setPlayhead(t: number | null): void
  /**
   * A seek requested from outside the replay (usually a click on the plot).
   * Separate from `playhead` so the replay can tell a seek request from the
   * value it published itself; one shared field makes the views loop.
   */
  seekTo: number | null
  requestSeek(t: number): void

  /** Height split between plot and replay when both are shown. */
  split: number
  setSplit(ratio: number): void
  clearFields(): void
  setTableMessage(message: string | null): void
  setSearch(search: string): void
  /** Put every plotted field on one axis, or give each its own. */
  gatherAxes(onto: 'one' | 'each'): void
  setShadeModes(on: boolean): void
}

const key = (f: { message: string; field: string }) => `${f.message}.${f.field}`

/**
 * The samples behind one trace, whether it was read or computed.
 *
 * Expressions are evaluated on demand rather than cached; with the log in
 * memory that costs a few milliseconds.
 */
export function traceSeries(log: ParsedLog, f: SelectedField): Series | null {
  if (!f.expression) return getSeries(log, f.message, f.field)
  try {
    const r = evaluateExpression(log, f.expression)
    return { message: '', field: f.expression, unit: '', time: r.time, values: r.values }
  } catch {
    // The log lacks a field the expression names; PlottedFields shows that.
    return null
  }
}

/** True when the expression actually reads something out of the log. */
function referencesIn(log: ParsedLog, text: string): boolean {
  try {
    return evaluateExpression(log, text).references.length > 0
  } catch {
    return false
  }
}

export const useLogStore = create<LogState>((set, get) => ({
  log: null,
  rawBytes: null,
  status: { kind: 'empty' },
  upper: 'none',
  selected: [],
  tableMessage: null,
  search: '',
  shadeModes: true,
  timeWindow: null,
  presets: loadPresets(),
  playhead: null,
  seekTo: null,
  split: loadSplit(),
  vehicleLogs: [],
  vehicleStatus: { kind: 'idle' },

  setVehicleLogs(vehicleLogs) {
    set({ vehicleLogs })
  },
  setVehicleStatus(vehicleStatus) {
    set({ vehicleStatus })
  },

  setStatus(status) {
    set({ status })
  },

  loadBytes(name, bytes) {
    set({ status: { kind: 'parsing', name } })
    try {
      const log = parseDataflash(bytes)
      if (log.messages.size === 0) {
        set({ status: { kind: 'error', text: `${name} is not a dataflash log.` } })
        return
      }
      set({
        log,
        rawBytes: bytes,
        status: { kind: 'ready', name },
        selected: [],
        upper: 'none',
        timeWindow: null,
        playhead: null,
        seekTo: null,
        split: loadSplit(),
        tableMessage: firstPresent(log, ['MODE', 'MSG', 'ATT']),
      })
    } catch (err) {
      set({
        status: {
          kind: 'error',
          text: err instanceof Error ? err.message : 'could not read that file',
        },
      })
    }
  },

  clear() {
    // Keep the vehicle's log listing so another can be opened from it.
    set({
      log: null,
      rawBytes: null,
      status: { kind: 'empty' },
      selected: [],
      upper: 'none',
      timeWindow: null,
      playhead: null,
      seekTo: null,
      split: loadSplit(),
      tableMessage: null,
      search: '',
    })
  },

  setUpper(upper) {
    // Opening a pane from 'none' splits the window evenly.
    set((s) => (s.upper === 'none' && upper !== 'none' ? { upper, split: 0.5 } : { upper }))
  },

  toggleField(field) {
    const { selected, log } = get()
    const k = key(field)
    const without = selected.filter((f) => key(f) !== k)
    if (without.length !== selected.length) {
      set({ selected: without })
      if (without.length === 0 && get().upper === 'plot') set({ upper: 'none' })
      return
    }
    if (get().upper !== 'plot') get().setUpper('plot')
    const unit = log ? fieldUnit(log, field.message, field.field) : ''
    const existing = selected.map((f) => ({
      axis: f.axis,
      unit: log ? fieldUnit(log, f.message, f.field) : '',
    }))
    set({ selected: [...selected, { ...field, axis: defaultAxis(existing, unit) }] })
  },

  addExpression(source) {
    const { log, selected } = get()
    if (!log) return 'Open a log first.'
    const text = source.trim()
    if (!text) return 'Type an expression, like ATT.DesRoll - ATT.Roll.'
    if (selected.some((f) => f.expression === text)) return 'That expression is already plotted.'
    const problem = expressionError(log, text)
    if (problem) return problem
    if (!referencesIn(log, text)) return 'That has no fields in it, so there is nothing to plot.'
    // Expressions have no unit, so they take the next free axis.
    const existing = selected.map((f) => ({
      axis: f.axis,
      unit: f.expression ? '' : fieldUnit(log, f.message, f.field),
    }))
    if (get().upper !== 'plot') get().setUpper('plot')
    set({
      selected: [
        ...get().selected,
        { message: '', field: text, expression: text, axis: defaultAxis(existing, '') },
      ],
    })
    return null
  },

  savePreset(name) {
    const presets = { ...get().presets, [name.trim()]: get().selected.map((f) => ({ ...f })) }
    set({ presets })
    savePresets(presets)
  },

  loadPreset(name) {
    const preset = get().presets[name]
    if (!preset) return
    set({ selected: preset.map((f) => ({ ...f })) })
    if (preset.length > 0) get().setUpper('plot')
  },

  deletePreset(name) {
    const presets = { ...get().presets }
    delete presets[name]
    set({ presets })
    savePresets(presets)
  },

  setFieldColor(field, color) {
    const k = key(field)
    set({ selected: get().selected.map((f) => (key(f) === k ? { ...f, color } : f)) })
  },

  setTimeWindow(timeWindow) {
    set({ timeWindow })
  },

  setPlayhead(playhead) {
    set({ playhead })
  },

  requestSeek(t) {
    set({ seekTo: t, playhead: t })
  },

  setSplit(ratio) {
    const clamped = Math.max(0.2, Math.min(0.8, ratio))
    set({ split: clamped })
    try {
      localStorage.setItem(SPLIT_KEY, String(clamped))
    } catch {
      // Storage unavailable; the split just is not remembered.
    }
  },

  setFieldAxis(field, axis) {
    const k = key(field)
    set({
      selected: get().selected.map((f) =>
        key(f) === k ? { ...f, axis: Math.max(0, Math.min(MAX_AXES - 1, axis)) } : f,
      ),
    })
  },

  clearFields() {
    set({ selected: [] })
    if (get().upper === 'plot') set({ upper: 'none' })
  },

  setTableMessage(tableMessage) {
    set({ tableMessage })
  },

  setSearch(search) {
    set({ search })
  },

  gatherAxes(onto) {
    const { selected } = get()
    set({
      selected:
        onto === 'one'
          ? selected.map((f) => ({ ...f, axis: 0 }))
          : selected.map((f, i) => ({ ...f, axis: Math.min(i, MAX_AXES - 1) })),
    })
  },

  setShadeModes(shadeModes) {
    set({ shadeModes })
  },
}))

function firstPresent(log: ParsedLog, names: string[]): string | null {
  for (const n of names) if (log.messages.has(n)) return n
  return null
}

/** Is this field currently plotted? */
export function isSelected(state: LogState, field: { message: string; field: string }): boolean {
  return state.selected.some((f) => key(f) === key(field))
}
