import { create } from 'zustand'
import { parseDataflash, type ParsedLog } from '../protocol/dataflash'

// The log being reviewed, and what is being looked at in it.
//
// One log at a time, held whole in memory: a ten-megabyte flight parses in
// about 150 ms and the columnar tables are smaller than the file was, so
// there is nothing to gain from streaming it and a great deal of complexity
// to lose. A log large enough to be a problem should move the parse into a
// worker before it moves it out of memory.

export type LogView = 'plot' | 'table'

/** One field selected for plotting. */
export interface SelectedField {
  message: string
  field: string
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
  /**
   * Draw every series on its own 0..1 scale.
   *
   * Off by default because a shared axis is the truthful view; on the
   * moment you put degrees and microseconds on one plot, where shape is the
   * only thing left worth comparing.
   */
  normalize: boolean

  /** Logs found on the vehicle, newest first. */
  vehicleLogs: VehicleLog[]
  vehicleStatus: VehicleLogStatus
  setVehicleLogs(logs: VehicleLog[]): void
  setVehicleStatus(status: VehicleLogStatus): void

  setStatus(status: LogStatus): void
  loadBytes(name: string, bytes: Uint8Array): void
  clear(): void
  setView(view: LogView): void
  toggleField(field: SelectedField): void
  clearFields(): void
  setTableMessage(message: string | null): void
  setSearch(search: string): void
  setNormalize(on: boolean): void
}

const key = (f: SelectedField) => `${f.message}.${f.field}`

export const useLogStore = create<LogState>((set, get) => ({
  log: null,
  rawBytes: null,
  status: { kind: 'empty' },
  view: 'plot',
  selected: [],
  tableMessage: null,
  search: '',
  normalize: false,
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
        // Open on something worth looking at rather than an empty plot: the
        // altitude trace is what nearly every review starts from.
        tableMessage: firstPresent(log, ['MODE', 'MSG', 'ATT']),
      })
      const opening = firstPresent(log, ['BARO', 'CTUN', 'ATT'])
      if (opening === 'BARO') get().toggleField({ message: 'BARO', field: 'Alt' })
      else if (opening === 'CTUN') get().toggleField({ message: 'CTUN', field: 'Alt' })
      else if (opening === 'ATT') get().toggleField({ message: 'ATT', field: 'Roll' })
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
      tableMessage: null,
      search: '',
    })
  },

  setView(view) {
    set({ view })
  },

  toggleField(field) {
    const { selected } = get()
    const k = key(field)
    const next = selected.filter((f) => key(f) !== k)
    set({ selected: next.length === selected.length ? [...selected, field] : next })
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

  setNormalize(normalize) {
    set({ normalize })
  },
}))

function firstPresent(log: ParsedLog, names: string[]): string | null {
  for (const n of names) if (log.messages.has(n)) return n
  return null
}

/** Is this field currently plotted? */
export function isSelected(state: LogState, field: SelectedField): boolean {
  return state.selected.some((f) => key(f) === key(field))
}
