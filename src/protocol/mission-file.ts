// Mission files. The common format is the tab-separated "QGC WPL 110"
// (.waypoints/.txt) that Mission Planner, QGroundControl and the SITL tooling
// all read and write; QGC's JSON .plan is import-only here.
//
// The wire type keeps lat/lon as degrees * 1e7; the file keeps degrees as
// text with seven decimals, the resolution the integer carries.
import type { MissionItem } from './types'

const HEADER = /^QGC WPL (\d+)\s*$/

/**
 * Parses a .waypoints file into items renumbered 0..n-1 in file order.
 * Line 0 of the body is home by convention; the caller interprets it.
 */
export function parseWaypointsFile(text: string): MissionItem[] {
  const lines = text.split(/\r?\n/)
  const head = lines[0] ?? ''
  const m = HEADER.exec(head.trim())
  if (!m) throw new Error('Not a mission file: expected a "QGC WPL 110" header')

  const items: MissionItem[] = []
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n]!.trim()
    if (line === '' || line.startsWith('#')) continue
    const cols = line.split(/\s+/)
    if (cols.length < 12)
      throw new Error(`Mission file line ${n + 1}: expected 12 columns, got ${cols.length}`)
    const num = cols.map(Number)
    if (num.some((v) => Number.isNaN(v))) {
      throw new Error(`Mission file line ${n + 1}: not a number where one was expected`)
    }
    items.push({
      // Renumbered: hand-edited files skip and repeat sequence numbers, and
      // ArduPilot requires them contiguous from 0.
      seq: items.length,
      current: num[1]!,
      frame: num[2]!,
      command: num[3]!,
      param1: num[4]!,
      param2: num[5]!,
      param3: num[6]!,
      param4: num[7]!,
      x: Math.round(num[8]! * 1e7),
      y: Math.round(num[9]! * 1e7),
      z: num[10]!,
      autocontinue: num[11]!,
    })
  }
  return items
}

/** Serializes items (seq 0 = home first) in the order given. */
export function serializeWaypointsFile(items: readonly MissionItem[]): string {
  const lines = ['QGC WPL 110']
  for (const i of items) {
    lines.push(
      [
        i.seq,
        i.current,
        i.frame,
        i.command,
        fmt(i.param1),
        fmt(i.param2),
        fmt(i.param3),
        fmt(i.param4),
        (i.x / 1e7).toFixed(7),
        (i.y / 1e7).toFixed(7),
        fmt(i.z),
        i.autocontinue,
      ].join('\t'),
    )
  }
  // Trailing newline: Mission Planner's parser wants the last line terminated.
  return lines.join('\n') + '\n'
}

/** Params print full precision but without float noise on round values. */
function fmt(v: number): string {
  return Number.isInteger(v) ? v.toFixed(6) : String(v)
}

export interface PlanImport {
  items: MissionItem[]
  /** The .plan's planned home, degrees * 1e7 and meters, if present. */
  home: { x: number; y: number; z: number } | null
}

/**
 * Imports a QGC .plan (JSON). Simple items only: complex items (Survey,
 * corridor scan, ...) are stored unexpanded, so they are refused by name
 * rather than dropped.
 */
export function parsePlanFile(text: string): PlanImport {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('Not a .plan file: invalid JSON')
  }
  const root = doc as {
    fileType?: string
    mission?: { items?: unknown[]; plannedHomePosition?: number[] }
  }
  if (root.fileType !== 'Plan' || !root.mission) {
    throw new Error('Not a .plan file: missing the Plan mission section')
  }

  const complex = (root.mission.items ?? [])
    .map((it) => it as { type?: string; complexItemType?: string })
    .filter((it) => it.type && it.type !== 'SimpleItem')
  if (complex.length > 0) {
    const kinds = [...new Set(complex.map((c) => c.complexItemType ?? c.type))].join(', ')
    throw new Error(`This .plan has items that cannot be imported: ${kinds}`)
  }

  const items: MissionItem[] = []
  // Home occupies seq 0 on the vehicle, so file items start at 1.
  let seq = 1
  for (const raw of root.mission.items ?? []) {
    const it = raw as {
      command?: number
      frame?: number
      autoContinue?: boolean
      params?: (number | null)[]
    }
    const p = it.params ?? []
    items.push({
      seq: seq++,
      frame: it.frame ?? 3,
      command: it.command ?? 16,
      current: 0,
      autocontinue: it.autoContinue === false ? 0 : 1,
      param1: p[0] ?? 0,
      param2: p[1] ?? 0,
      param3: p[2] ?? 0,
      param4: p[3] ?? 0,
      x: Math.round((p[4] ?? 0) * 1e7),
      y: Math.round((p[5] ?? 0) * 1e7),
      z: p[6] ?? 0,
    })
  }

  const hp = root.mission.plannedHomePosition
  const home =
    hp && hp.length >= 2
      ? { x: Math.round(hp[0]! * 1e7), y: Math.round(hp[1]! * 1e7), z: hp[2] ?? 0 }
      : null
  return { items, home }
}
