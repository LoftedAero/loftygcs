import { create } from 'zustand'
import { fieldUnit, parseDataflash, type ParsedLog } from '../protocol/dataflash'

// The log being reviewed, and what is being looked at in it.
//
// One log at a time, held whole in memory: a ten-megabyte flight parses in
// about 150 ms and the columnar tables are smaller than the file was, so
// there is nothing to gain from streaming it and a great deal of complexity
// to lose. A log large enough to be a problem should move the parse into a
// worker before it moves it out of memory.

export type LogView = 'plot' | 'table' | 'replay'

/** How many y axes the plot will draw at once. */
export const MAX_AXES = 4

/** One field selected for plotting. */
export interface SelectedField {
  message: string
  field: string
  /** Which y axis it is drawn against, 0-based. */
  axis: number
  /** Trace color. Unset means the default for its position in the list. */
  color?: string
}

/**
 * Default trace colors, in order.
 *
 * The house palette's working colors first, then enough distinct hues to
 * tell eight traces apart. A field keeps whichever it was given until the
 * user says otherwise -- so removing a trace does not recolor the rest,
 * which would make a plot you were reading rearrange itself.
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
 * Fields measured in the same unit share an axis, because that is nearly
 * always what was meant: adding Pitch after Roll means comparing them, and
 * putting them on separate scales would make two different pictures of the
 * same wobble. A new unit takes the next free axis until they run out, and
 * after that it joins the axis that already has the most company -- crowded
 * beats invisible, and the field can be moved.
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
   * The file exactly as it arrived.
   *
   * Kept so a log pulled off the vehicle can be saved without fetching it
   * twice -- the parsed tables are lossy and cannot be turned back into a
   * .bin. It is a second copy of a few megabytes, which is the cheaper half
   * of that trade.
   */
  rawBytes: Uint8Array | null
  status: LogStatus
  view: LogView
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
  setView(view: LogView): void
  /** Add or remove a field. The axis is chosen for it; see defaultAxis. */
  toggleField(field: { message: string; field: string }): void
  /** Move a plotted field to another axis. */
  setFieldAxis(field: { message: string; field: string }, axis: number): void
  /** Recolor a plotted field. */
  setFieldColor(field: { message: string; field: string }, color: string): void

  /**
   * The visible time window, or null for the whole log.
   *
   * In the store rather than in the plot because the statistics beside each
   * field are for what is on screen, and they are drawn somewhere else.
   */
  timeWindow: { t0: number; t1: number } | null
  setTimeWindow(window: { t0: number; t1: number } | null): void

  /**
   * Where the replay has got to, in seconds since boot, or null when it is
   * not running.
   *
   * Shared so the plot can mark the same instant: watching the aircraft fly
   * and reading what its sensors said at that moment is the point of having
   * both views in one tool rather than two.
   */
  playhead: number | null
  setPlayhead(t: number | null): void
  clearFields(): void
  setTableMessage(message: string | null): void
  setSearch(search: string): void
  /** Put every plotted field on one axis, or give each its own. */
  gatherAxes(onto: 'one' | 'each'): void
  setShadeModes(on: boolean): void
}

const key = (f: { message: string; field: string }) => `${f.message}.${f.field}`

export const useLogStore = create<LogState>((set, get) => ({
  log: null,
  rawBytes: null,
  status: { kind: 'empty' },
  view: 'plot',
  selected: [],
  tableMessage: null,
  search: '',
  shadeModes: true,
  timeWindow: null,
  playhead: null,
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
        // Nothing plotted to begin with. Opening on an altitude trace was
        // a guess at what the reader came for, and a wrong guess is a field
        // to remove before starting rather than a head start.
        selected: [],
        timeWindow: null,
  playhead: null,
        tableMessage: firstPresent(log, ['MODE', 'MSG', 'ATT']),
      })
    } catch (err) {
      set({ status: { kind: 'error', text: err instanceof Error ? err.message : 'could not read that file' } })
    }
  },

  clear() {
    // The vehicle's listing survives: after looking at one log the next
    // thing anyone does is open another from the same aircraft.
    set({
      log: null,
      rawBytes: null,
      status: { kind: 'empty' },
      selected: [],
      timeWindow: null,
  playhead: null,
      tableMessage: null,
      search: '',
    })
  },

  setView(view) {
    set({ view })
  },

  toggleField(field) {
    const { selected, log } = get()
    const k = key(field)
    const without = selected.filter((f) => key(f) !== k)
    if (without.length !== selected.length) {
      set({ selected: without })
      return
    }
    const unit = log ? fieldUnit(log, field.message, field.field) : ''
    const existing = selected.map((f) => ({
      axis: f.axis,
      unit: log ? fieldUnit(log, f.message, f.field) : '',
    }))
    set({ selected: [...selected, { ...field, axis: defaultAxis(existing, unit) }] })
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
