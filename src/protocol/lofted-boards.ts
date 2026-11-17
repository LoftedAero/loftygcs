// The catalog of Lofted Aero flight controllers and their firmware, as
// published in LoftedAero/ardupilot-builds:
//
//     index.json                      { "format": 1, "releases": ["2026-11-16", ...] }
//     releases/<release>/boards.json  one release: boards and their firmware options
//     releases/<release>/<files>      the images boards.json names
//
// A firmware option is two images of one build: the .apj an ArduPilot
// bootloader takes, and the same firmware with that bootloader in front of it
// (the build's _with_bl.hex) for a blank board's ROM DFU.
//
// A board's facts (board id, receiver wiring) can change between
// releases, so they are read from the first release in the index that lists
// the board.
// Everything here comes from the network and is checked before use: a file
// path must stay inside its release folder, and every image carries its size
// and SHA-256.

export const CATALOG_FORMAT = 1

/** One image a release ships, relative to the release's folder. */
export interface CatalogFile {
  file: string
  size: number
  sha256: string
}

export interface FirmwareOption extends CatalogFile {
  /** Stable key, e.g. "stabrx" or "ardupilot". */
  id: string
  /** What the user picks, e.g. "StabRX". */
  name: string
  /** The .hex for ROM DFU: the bootloader and this firmware in one image. */
  withBootloader: CatalogFile
  /**
   * The receiver port's SERIALn_PROTOCOL while the receiver is written: a
   * protocol this build does not compile in, so nothing touches the port
   * (docs/architecture.md, Lofted Aero boards).
   */
  passthroughProtocol: number
}

/** How the board's ELRS receiver is wired to the flight controller. */
export interface ReceiverWiring {
  /** ExpressLRS target path in its targets.json, e.g. "newbeedrone.rx_2400.c324d". */
  target: string
  /** SERIALn the receiver is on. */
  serial: number
  /** ArduPilot GPIO numbers driving the ESP32's BOOT strap and EN (reset). */
  bootPin: number
  enPin: number
  /** CRSF baud the build expects (RC_OPTIONS bit 13 selects 420000). */
  baud: number
}

export interface CatalogBoard {
  /** Stable key, e.g. "f405-srx"; the app's pictures for the board are keyed on it. */
  id: string
  name: string
  /** APJ_BOARD_ID: what the ArduPilot bootloader and AUTOPILOT_VERSION report. */
  boardId: number
  receiver: ReceiverWiring | null
  firmware: FirmwareOption[]
}

export interface CatalogRelease {
  /** Folder name under releases/, which is also how a release is named on screen. */
  name: string
  version: string
  date: string
  boards: CatalogBoard[]
}

const fail = (where: string, what: string): never => {
  throw new Error(`${where}: ${what}`)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function str(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key]
  if (typeof v !== 'string' || v.trim() === '') fail(where, `${key} is missing`)
  return v as string
}

function int(o: Record<string, unknown>, key: string, where: string): number {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(where, `${key} is not a whole number`)
  return v as number
}

/** A relative path that cannot leave its release folder. */
export function safeRelativePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path)) {
    return false
  }
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

/** A release folder name: one path segment, nothing that needs escaping. */
const RELEASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function file(o: unknown, where: string): CatalogFile {
  if (!isObject(o)) return fail(where, 'is not an object')
  const name = str(o, 'file', where)
  if (!safeRelativePath(name)) fail(where, `file "${name}" is outside the release`)
  const size = int(o, 'size', where)
  if (size <= 0) fail(where, 'size must be positive')
  const sha256 = str(o, 'sha256', where).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(where, 'sha256 is not a SHA-256 hash')
  return { file: name, size, sha256 }
}

function receiver(o: unknown, where: string): ReceiverWiring | null {
  if (o === undefined) return null
  if (!isObject(o)) return fail(where, 'is not an object')
  const target = str(o, 'target', where)
  if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){2}$/.test(target)) {
    fail(where, `target "${target}" is not an ExpressLRS target path`)
  }
  const wiring = {
    target,
    serial: int(o, 'serial', where),
    bootPin: int(o, 'bootPin', where),
    enPin: int(o, 'enPin', where),
    baud: int(o, 'baud', where),
  }
  if (wiring.serial < 1 || wiring.serial > 9) fail(where, 'serial must be 1 to 9')
  if (wiring.bootPin === wiring.enPin) fail(where, 'bootPin and enPin must differ')
  return wiring
}

function board(o: unknown, where: string): CatalogBoard {
  if (!isObject(o)) return fail(where, 'is not an object')
  const id = str(o, 'id', where)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(where, `id "${id}" must be lower case`)
  const at = `${where} ${id}`
  const boardId = int(o, 'boardId', at)
  if (boardId <= 0 || boardId > 0xffff) fail(at, 'boardId is out of range')
  const list = o.firmware
  if (!Array.isArray(list) || list.length === 0) fail(at, 'firmware lists nothing')
  const firmware = (list as unknown[]).map((f, i) => {
    const w = `${at} firmware ${i + 1}`
    if (!isObject(f)) return fail(w, 'is not an object')
    const option = {
      ...file(f, w),
      id: str(f, 'id', w),
      name: str(f, 'name', w),
      withBootloader: file(f.withBootloader, `${w} withBootloader`),
      passthroughProtocol: int(f, 'passthroughProtocol', w),
    }
    if (!option.file.endsWith('.apj')) fail(w, 'firmware must be an .apj')
    if (!option.withBootloader.file.endsWith('.hex')) fail(w, 'withBootloader must be a .hex')
    return option
  })
  const ids = new Set(firmware.map((f) => f.id))
  if (ids.size !== firmware.length) fail(at, 'two firmware options share an id')
  return {
    id,
    name: str(o, 'name', at),
    boardId,
    receiver: receiver(o.receiver, `${at} receiver`),
    firmware,
  }
}

/** The list of releases, in the publisher's order: current first. */
export function parseCatalogIndex(json: unknown): string[] {
  if (!isObject(json)) return fail('index.json', 'is not an object')
  if (json.format !== CATALOG_FORMAT)
    fail('index.json', `format ${String(json.format)} is not supported`)
  const list = json.releases
  if (!Array.isArray(list)) return fail('index.json', 'releases is not a list')
  for (const r of list) {
    if (typeof r !== 'string' || !RELEASE_NAME.test(r))
      fail('index.json', `"${String(r)}" is not a release name`)
  }
  return list as string[]
}

/** One release's boards.json. */
export function parseRelease(name: string, json: unknown): CatalogRelease {
  const where = `${name}/boards.json`
  if (!RELEASE_NAME.test(name)) fail(where, 'bad release name')
  if (!isObject(json)) return fail(where, 'is not an object')
  if (json.format !== CATALOG_FORMAT) fail(where, `format ${String(json.format)} is not supported`)
  const list = json.boards
  if (!Array.isArray(list)) return fail(where, 'boards is not a list')
  const boards = (list as unknown[]).map((b) => board(b, where))
  if (new Set(boards.map((b) => b.id)).size !== boards.length) fail(where, 'two boards share an id')
  return { name, version: str(json, 'version', where), date: str(json, 'date', where), boards }
}

/** A board as the app offers it: its current facts, and every release that has it. */
export interface BoardEntry {
  board: CatalogBoard
  /** In the index's order, current first; each with the board as that release describes it. */
  releases: { release: CatalogRelease; board: CatalogBoard }[]
}

/**
 * Group releases by board, in the index's order, which the publisher sets by
 * the ArduPilot version a build is based on and then by build date. `date` is
 * not the order: a 4.7 build made after a 4.8 one is still listed below it.
 * The first release that lists a board gives its facts, and the first with an
 * option is that option's current one.
 */
export function boardsIn(releases: CatalogRelease[]): BoardEntry[] {
  const byId = new Map<string, BoardEntry>()
  for (const release of releases) {
    for (const b of release.boards) {
      const entry = byId.get(b.id)
      if (entry) entry.releases.push({ release, board: b })
      else byId.set(b.id, { board: b, releases: [{ release, board: b }] })
    }
  }
  return [...byId.values()].sort((a, b) => a.board.name.localeCompare(b.board.name))
}

/**
 * What a release list shows for each release, in the index's order: its
 * `version`, with "latest" on the first. `version` is display text, read as
 * "StabRX-4.8.0-dev (262cde4d)" (product, ArduPilot version, the hash the
 * firmware reports); nothing parses or compares it. Two releases whose
 * versions read the same are told apart by their folder names.
 *
 * A label `fits` rejects is shortened, never clipped: first by the product
 * (`product`, the option's name, already on its tile), then by losing its end
 * to "…", so the ArduPilot version, which sets the order, is what stays.
 */
export function releaseLabels(
  releases: CatalogRelease[],
  fits: (label: string) => boolean = () => true,
  product?: string,
): string[] {
  const count = new Map<string, number>()
  for (const r of releases) count.set(r.version, (count.get(r.version) ?? 0) + 1)
  return releases.map((r, i) => {
    const latest = i === 0 ? ' · latest' : ''
    const named = (v: string) => (count.get(r.version)! > 1 ? `${v} · ${r.name}` : v) + latest
    const full = named(r.version)
    if (fits(full)) return full
    const prefix = product ? `${product}-` : null
    const short =
      prefix && r.version.startsWith(prefix) && r.version.length > prefix.length
        ? named(r.version.slice(prefix.length))
        : full
    if (fits(short)) return short
    let cut = short
    while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1)
    return `${cut.trimEnd()}…`
  })
}

/** The catalog board a connected vehicle is, by its APJ_BOARD_ID. */
export function boardForId(entries: BoardEntry[], boardId: number): BoardEntry | null {
  if (boardId <= 0) return null
  return entries.find((e) => e.board.boardId === boardId) ?? null
}
