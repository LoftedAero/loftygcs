// ArduPilot dataflash logs (.bin): the self-describing binary format the
// vehicle writes to its SD card, and what MAVFTP hands back from /APM/LOGS.
//
// The format explains itself as it goes. Every message is
//
//     A3 95 <type> <payload...>
//
// and the payload's shape is whatever a FMT message earlier in the file
// said that type looks like. FMT describes itself first (type 128, always
// "BBnNZ"), so a reader needs exactly one hard-coded fact to bootstrap the
// rest. That is the whole trick, and it means a log from a firmware this
// code has never seen still parses -- new messages included.
//
// Two consequences worth stating, because they shape everything below:
//
//   - Field *units* are not in FMT. They arrive later, in FMTU messages
//     that reference the unit and multiplier tables declared by UNIT and
//     MULT messages, which may themselves appear after the data they
//     describe. So units are resolved in a second pass, not inline.
//   - A type with no FMT is unparseable, and its length is unknown, so
//     there is nothing to skip. The only recovery is to hunt for the next
//     header. That happens in practice at the very start of a log that was
//     truncated, and on a log pulled off a card mid-write.
//
// Storage is columnar: one array per field, not one object per record. A
// ten-megabyte log is a few hundred thousand records, and the object-per-
// record shape costs an order of magnitude more memory and makes plotting a
// gather instead of a slice.

/** Every message begins with these two bytes. */
export const HEAD1 = 0xa3
export const HEAD2 = 0x95

/** The one type a reader has to know before it has read anything. */
export const FMT_TYPE = 128

export interface FieldSpec {
  name: string
  /** The format character from FMT. */
  format: string
  /** Unit name from FMTU/UNIT, once resolved: 'm', 'm/s', 'deg'... */
  unit?: string
  /** Multiplier from FMTU/MULT, already applied to the stored values. */
  multiplier?: number
}

export interface MessageFormat {
  type: number
  name: string
  /** Bytes on the wire, including the three-byte header. */
  length: number
  fields: FieldSpec[]
}

/**
 * One message type's records, stored column-wise.
 *
 * Numeric fields are Float64Array; string fields (n/N/Z) are string[]. A
 * field is one or the other for the whole log, decided by its format char.
 */
export interface MessageTable {
  format: MessageFormat
  count: number
  columns: Map<string, Float64Array | string[]>
}

export interface ParsedLog {
  /** Message tables by name: 'ATT', 'GPS', 'RCOU'... */
  messages: Map<string, MessageTable>
  /** Every PARM record, last value wins -- the vehicle's config at log time. */
  params: Map<string, number>
  /** Anything the file did that it should not have. */
  problems: string[]
  /** Bytes that belonged to no parseable message. */
  skippedBytes: number
}

/** Bytes each format character occupies on the wire. */
const FORMAT_SIZES: Record<string, number> = {
  a: 64, // int16_t[32]
  b: 1,
  B: 1,
  h: 2,
  H: 2,
  i: 4,
  I: 4,
  f: 4,
  d: 8,
  n: 4,
  N: 16,
  Z: 64,
  c: 2,
  C: 2,
  e: 4,
  E: 4,
  L: 4,
  M: 1,
  q: 8,
  Q: 8,
}

/** Format characters that decode to text rather than a number. */
const TEXT_FORMATS = new Set(['n', 'N', 'Z'])

export function formatSize(format: string): number {
  return FORMAT_SIZES[format] ?? 0
}

/** Total payload bytes for a format string, or null if a char is unknown. */
export function payloadSize(format: string): number | null {
  let total = 0
  for (const ch of format) {
    const size = FORMAT_SIZES[ch]
    if (size === undefined) return null
    total += size
  }
  return total
}

/**
 * Scaling implied by a format character, for logs with no MULT table.
 *
 * c/C/e/E are documented as "integer * 100", and modern logs *also* carry a
 * MULT of 0.01 for those fields -- the same scaling stated twice. Applying
 * both turns the EKF origin altitude at Canberra from 584.09 m into 5.84 m,
 * which is how this was found. So exactly one is applied: MULT when the log
 * declares one, this table when it does not.
 */
const FORMAT_SCALE: Record<string, number> = { c: 0.01, C: 0.01, e: 0.01, E: 0.01 }

/**
 * Nudge a multiplier back onto the power of ten it was written as.
 *
 * The MULT table is authored as float32 and widened on the way in, so 1e-7
 * arrives as 1.0000000116860974e-7. Left alone it turns a latitude of
 * -35.3632624 into -35.363262413258525 -- a millimetre of error, but a
 * number that looks wrong in a table and invites the reader to distrust it.
 * Only snaps when the value is already within a hair of the power of ten,
 * so a genuinely odd multiplier is left exactly as the file gave it.
 */
function snapPowerOfTen(mult: number): number {
  const exponent = Math.round(Math.log10(Math.abs(mult)))
  const nearest = Math.pow(10, exponent)
  return Math.abs(mult - nearest) / nearest < 1e-6 ? nearest : mult
}

/** Unit labels that mean "no unit", however the firmware spelled it. */
const NO_UNIT = new Set(['', '-', '?', 'UNKNOWN'])

/** Growable column of numbers, so a table is not sized before it is read. */
class NumberColumn {
  private data = new Float64Array(1024)
  private n = 0
  push(v: number) {
    if (this.n === this.data.length) {
      const next = new Float64Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    this.data[this.n++] = v
  }
  finish(): Float64Array {
    return this.data.subarray(0, this.n)
  }
}

/**
 * Read a dataflash log.
 *
 * Never throws on malformed input: a log pulled off a vehicle mid-write is
 * normal, and half a log is worth reading. Everything the file got wrong is
 * reported in `problems` instead.
 */
export function parseDataflash(bytes: Uint8Array): ParsedLog {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const formats = new Map<number, MessageFormat>()
  const tables = new Map<string, { format: MessageFormat; cols: Map<string, NumberColumn | string[]> }>()
  const params = new Map<string, number>()
  const problems: string[] = []
  let skippedBytes = 0

  // FMTU/UNIT/MULT resolve against each other and can arrive in any order,
  // so they are collected and applied once the whole file has been read.
  const unitTable = new Map<number, string>()
  const multTable = new Map<number, number>()
  const fmtu: { type: number; units: string; mults: string }[] = []

  let i = 0
  while (i + 3 <= bytes.length) {
    if (bytes[i] !== HEAD1 || bytes[i + 1] !== HEAD2) {
      // Not a header. Hunt for the next one rather than giving up: the
      // alternative is discarding a whole log for one bad byte.
      i++
      skippedBytes++
      continue
    }
    const type = bytes[i + 2]!

    if (type === FMT_TYPE) {
      // FMT's own shape is the bootstrap fact: BBnNZ, 89 bytes with header.
      if (i + 89 > bytes.length) break
      const fmt = readFormat(bytes, i + 3)
      if (fmt) formats.set(fmt.type, fmt)
      i += 89
      continue
    }

    const format = formats.get(type)
    if (!format) {
      // No FMT for this type means its length is unknown, so there is
      // nothing to skip past -- only the next header to find.
      i++
      skippedBytes++
      continue
    }
    if (i + format.length > bytes.length) break

    const values = readRecord(bytes, view, i + 3, format)
    appendRecord(tables, format, values)

    // The three tables that describe the rest of the file.
    if (format.name === 'UNIT') {
      const id = values[1]
      const label = values[2]
      if (typeof id === 'number' && typeof label === 'string') unitTable.set(id, label)
    } else if (format.name === 'MULT') {
      const id = values[1]
      const mult = values[2]
      if (typeof id === 'number' && typeof mult === 'number') multTable.set(id, mult)
    } else if (format.name === 'FMTU') {
      const t = values[1]
      const units = values[2]
      const mults = values[3]
      if (typeof t === 'number' && typeof units === 'string' && typeof mults === 'string') {
        fmtu.push({ type: t, units, mults })
      }
    } else if (format.name === 'PARM') {
      // Name and Value, whatever their positions -- PARM gained a Default
      // column in 4.x and the older shape must still read.
      const nameIdx = format.fields.findIndex((f) => f.name === 'Name')
      const valueIdx = format.fields.findIndex((f) => f.name === 'Value')
      const name = values[nameIdx]
      const value = values[valueIdx]
      if (typeof name === 'string' && typeof value === 'number') params.set(name, value)
    }

    i += format.length
  }

  applyUnits(formats, fmtu, unitTable, multTable)

  const messages = new Map<string, MessageTable>()
  for (const [name, t] of tables) {
    const columns = new Map<string, Float64Array | string[]>()
    let count = 0
    for (const [field, col] of t.cols) {
      const finished = col instanceof NumberColumn ? col.finish() : col
      if (finished instanceof Float64Array) {
        const spec = t.format.fields.find((f) => f.name === field)
        // The scale is applied here, once, so every consumer -- plot, table,
        // export -- sees the same number in the unit the field claims.
        const scale = spec?.multiplier
        if (scale !== undefined && scale !== 1) {
          for (let k = 0; k < finished.length; k++) finished[k] = finished[k]! * scale
        }
        // TimeUS is microseconds and its declared multiplier is 1e-6, so it
        // is already seconds by now on any log that carries FMTU. On one
        // that does not, make it seconds anyway: everything downstream plots
        // against a time axis and must not have to ask which kind it got.
        if (field === 'TimeUS' && scale === undefined) {
          for (let k = 0; k < finished.length; k++) finished[k] = finished[k]! / 1e6
        }
      }
      columns.set(field, finished)
      count = finished.length
    }
    messages.set(name, { format: t.format, count, columns })
  }

  if (formats.size === 0) problems.push('No FMT messages: this does not look like a dataflash log.')
  if (skippedBytes > 0) problems.push(`${skippedBytes} bytes did not belong to any message.`)

  return { messages, params, problems, skippedBytes }
}

/** Decode a FMT payload: type, length, name(4), format(16), columns(64). */
function readFormat(bytes: Uint8Array, at: number): MessageFormat | null {
  const type = bytes[at]!
  const length = bytes[at + 1]!
  const name = readText(bytes, at + 2, 4)
  const format = readText(bytes, at + 6, 16)
  const columns = readText(bytes, at + 22, 64)
  if (!name) return null
  const labels = columns ? columns.split(',') : []
  const fields: FieldSpec[] = []
  for (let f = 0; f < format.length; f++) {
    fields.push({ name: labels[f] ?? `f${f}`, format: format[f]! })
  }
  return { type, name, length, fields }
}

/** A fixed-width character field, cut at its first NUL. */
function readText(bytes: Uint8Array, at: number, width: number): string {
  let end = at
  const limit = Math.min(at + width, bytes.length)
  while (end < limit && bytes[end] !== 0) end++
  return String.fromCharCode(...bytes.subarray(at, end))
}

/** Decode one record's fields in declaration order. */
function readRecord(
  bytes: Uint8Array,
  view: DataView,
  at: number,
  format: MessageFormat,
): (number | string)[] {
  const out: (number | string)[] = []
  let p = at
  for (const field of format.fields) {
    const size = FORMAT_SIZES[field.format] ?? 0
    if (p + size > bytes.length) {
      out.push(0)
      continue
    }
    out.push(readField(bytes, view, p, field.format))
    p += size
  }
  return out
}

function readField(
  bytes: Uint8Array,
  view: DataView,
  at: number,
  format: string,
): number | string {
  switch (format) {
    case 'b':
      return view.getInt8(at)
    case 'B':
    case 'M':
      return view.getUint8(at)
    case 'h':
      return view.getInt16(at, true)
    case 'H':
      return view.getUint16(at, true)
    case 'i':
    case 'L':
      return view.getInt32(at, true)
    case 'I':
      return view.getUint32(at, true)
    case 'f':
      return view.getFloat32(at, true)
    case 'd':
      return view.getFloat64(at, true)
    case 'q':
      // Beyond 2^53 this loses precision, but the only q/Q fields in
      // practice are microsecond timestamps, which stay exact for ~285
      // years -- and a Float64Array could not hold more anyway.
      return Number(view.getBigInt64(at, true))
    case 'Q':
      return Number(view.getBigUint64(at, true))
    // The scaled integer forms decode raw here. Their scaling is applied
    // once, at the end, from MULT or from FORMAT_SCALE -- never both.
    case 'c':
      return view.getInt16(at, true)
    case 'C':
      return view.getUint16(at, true)
    case 'e':
      return view.getInt32(at, true)
    case 'E':
      return view.getUint32(at, true)
    case 'n':
      return readText(bytes, at, 4)
    case 'N':
      return readText(bytes, at, 16)
    case 'Z':
      return readText(bytes, at, 64)
    case 'a':
      // int16_t[32]: an array field. Nothing plots it, and flattening it
      // into columns would invent 32 fields, so it reads as its first
      // element and the rest is left on the floor deliberately.
      return view.getInt16(at, true)
    default:
      return 0
  }
}

function appendRecord(
  tables: Map<string, { format: MessageFormat; cols: Map<string, NumberColumn | string[]> }>,
  format: MessageFormat,
  values: (number | string)[],
) {
  let table = tables.get(format.name)
  if (!table) {
    const cols = new Map<string, NumberColumn | string[]>()
    for (const f of format.fields) {
      cols.set(f.name, TEXT_FORMATS.has(f.format) ? [] : new NumberColumn())
    }
    table = { format, cols }
    tables.set(format.name, table)
  }
  format.fields.forEach((f, idx) => {
    const col = table.cols.get(f.name)
    const v = values[idx]
    if (col instanceof NumberColumn) col.push(typeof v === 'number' ? v : 0)
    else if (Array.isArray(col)) col.push(typeof v === 'string' ? v : String(v ?? ''))
  })
}

/**
 * Second pass: attach units and multipliers to the field specs.
 *
 * FMTU names a message type and gives one unit id and one multiplier id per
 * field, as character codes indexing the UNIT and MULT tables. Those tables
 * are themselves ordinary log messages with no guarantee of appearing before
 * the FMTU that cites them, which is why this cannot happen inline.
 *
 * Both tables are read from the file rather than hard-coded. A firmware that
 * adds a unit still labels correctly, and there is no second list here to
 * drift out of agreement with the vehicle.
 */
function applyUnits(
  formats: Map<number, MessageFormat>,
  fmtu: { type: number; units: string; mults: string }[],
  unitTable: Map<number, string>,
  multTable: Map<number, number>,
) {
  for (const entry of fmtu) {
    const format = formats.get(entry.type)
    if (!format) continue
    format.fields.forEach((field, idx) => {
      const label = unitTable.get(entry.units.charCodeAt(idx))
      if (label !== undefined && !NO_UNIT.has(label)) field.unit = label

      const mult = multTable.get(entry.mults.charCodeAt(idx))
      // ArduPilot's table declares '-' as *zero*, meaning "no multiplier"
      // -- a string field, mostly. Taken literally it would zero the column.
      if (mult !== undefined && mult !== 0 && mult !== 1) field.multiplier = snapPowerOfTen(mult)
    })
  }
  // Anything FMTU did not cover falls back to the format character.
  for (const format of formats.values()) {
    for (const field of format.fields) {
      if (field.multiplier === undefined) {
        const scale = FORMAT_SCALE[field.format]
        if (scale !== undefined) field.multiplier = scale
      }
    }
  }
}

/**
 * A field as a plottable series, paired with its time base.
 *
 * Time comes from the message's own TimeUS column, which nearly every
 * ArduPilot message carries; without one there is nothing to plot against
 * and the caller gets null rather than an index-based fake.
 */
export interface Series {
  message: string
  field: string
  unit: string
  /** Seconds since boot. */
  time: Float64Array
  values: Float64Array
}

export function getSeries(log: ParsedLog, message: string, field: string): Series | null {
  const table = log.messages.get(message)
  if (!table) return null
  const values = table.columns.get(field)
  const time = table.columns.get('TimeUS')
  if (!(values instanceof Float64Array) || !(time instanceof Float64Array)) return null
  const spec = table.format.fields.find((f) => f.name === field)
  // Columns arrive already scaled and TimeUS already in seconds; rescaling
  // here is how a value gets multiplied twice.
  return { message, field, unit: spec?.unit ?? '', time, values }
}

/** Every plottable field, for a picker. Text and time columns are not. */
export function plottableFields(log: ParsedLog): { message: string; field: string; unit: string }[] {
  const out: { message: string; field: string; unit: string }[] = []
  for (const [name, table] of log.messages) {
    if (!table.columns.has('TimeUS')) continue
    for (const f of table.format.fields) {
      if (f.name === 'TimeUS' || TEXT_FORMATS.has(f.format)) continue
      out.push({ message: name, field: f.name, unit: f.unit ?? '' })
    }
  }
  return out
}
