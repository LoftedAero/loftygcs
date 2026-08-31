// Parameter files, and comparing one against a vehicle.
//
// The format is Mission Planner's `.param`: one `NAME,VALUE` per line, `#`
// for comments. Tabs and spaces appear as separators in the wild too, since
// the format is really "whatever a decade of tools have written", so all
// three are accepted on the way in and commas written on the way out.
//
// Kept here rather than in the component because comparing a file against a
// vehicle is the part with judgement in it -- what counts as a difference,
// what to do about a parameter the vehicle has never heard of -- and that
// deserves tests rather than a reading.

export interface ParamFileEntry {
  name: string
  value: number
}

export interface ParamFileParse {
  entries: ParamFileEntry[]
  /** Lines that looked like data but were not, with their line numbers. */
  skipped: { line: number; text: string }[]
}

export function parseParamFile(text: string): ParamFileParse {
  const entries: ParamFileEntry[] = []
  const skipped: { line: number; text: string }[] = []
  const seen = new Set<string>()

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const parts = line.split(/[,\t ]+/).filter(Boolean)
    const name = parts[0]?.toUpperCase()
    const value = Number(parts[1])
    if (!name || parts.length < 2 || !Number.isFinite(value)) {
      skipped.push({ line: i + 1, text: line.slice(0, 80) })
      return
    }
    // A later line wins, which is what every other tool does with a file
    // that lists the same parameter twice.
    if (seen.has(name)) {
      const at = entries.findIndex((e) => e.name === name)
      if (at >= 0) entries[at] = { name, value }
      return
    }
    seen.add(name)
    entries.push({ name, value })
  })

  return { entries, skipped }
}

export function serializeParamFile(entries: readonly ParamFileEntry[]): string {
  return entries.map((e) => `${e.name},${e.value}`).join('\n') + '\n'
}

export type CompareStatus =
  /** Present on both, and the values differ. */
  | 'changed'
  /** Present on both, same value. */
  | 'same'
  /** In the file, but this vehicle has no such parameter. */
  | 'missing'

export interface CompareRow {
  name: string
  fileValue: number
  /** Undefined when the vehicle does not have this parameter. */
  currentValue: number | undefined
  status: CompareStatus
}

/**
 * What a file would change about a vehicle.
 *
 * `missing` is a real category, not an error: parameter sets move between
 * firmware versions and vehicle types, and a Copter file loaded onto a Plane
 * is mostly parameters that do not exist here. Dropping them silently would
 * hide the fact that most of the file did not apply -- which is exactly the
 * moment somebody assumes a configuration transferred when it did not.
 */
export function compareParams(
  file: readonly ParamFileEntry[],
  current: ReadonlyMap<string, { value: number }>,
): CompareRow[] {
  return file.map((e) => {
    const entry = current.get(e.name)
    if (!entry) return { name: e.name, fileValue: e.value, currentValue: undefined, status: 'missing' as const }
    return {
      name: e.name,
      fileValue: e.value,
      currentValue: entry.value,
      // float32 round-tripping means an unchanged parameter can differ in
      // the twelfth decimal; treating that as a change would offer a list of
      // edits that do nothing.
      status: sameValue(e.value, entry.value) ? ('same' as const) : ('changed' as const),
    }
  })
}

/** Equal to within float32's real precision. */
export function sameValue(a: number, b: number): boolean {
  if (a === b) return true
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= scale * 1e-6
}

export interface CompareSummary {
  changed: number
  same: number
  missing: number
}

export function summarize(rows: readonly CompareRow[]): CompareSummary {
  const out: CompareSummary = { changed: 0, same: 0, missing: 0 }
  for (const r of rows) out[r.status]++
  return out
}
