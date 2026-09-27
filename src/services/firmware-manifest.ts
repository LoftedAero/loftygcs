// Official-firmware index from firmware.ardupilot.org/manifest.json.gz.
// That host sends no CORS headers, so this only works where the Electron
// main-process fetch bridge exists; the browser build offers file loading
// and a link-out instead.

export interface FirmwareOption {
  /** `mav-type`; see MAV_TYPES below. */
  vehicle: string
  /** What to call `vehicle` on screen. */
  vehicleLabel: string
  channel: 'stable' | 'beta' | 'dev'
  /**
   * True only for the row ArduPilot's `/stable/` path serves. The manifest
   * lists every release ever published, so this marks the current one.
   */
  current: boolean
  platform: string
  version: string
  url: string
  boardId: number
  /** What the board's bootloader calls itself, e.g. "CubeOrange-BL". */
  bootloaderStr: string[]
  /** The board's marketing name, where the manifest carries one. */
  brandName: string | null
}

/**
 * Keyed on `mav-type`, not `vehicletype`.
 *
 * `vehicletype: "Copter"` covers both multirotors and traditional helis,
 * which `mav-type` splits into Copter and HELICOPTER: different firmware
 * images. Mission Planner joins on `mav-type` too; board id x mav-type x
 * channel is exactly one row for most boards, where on `vehicletype` the heli
 * build always sits beside the multirotor one.
 */
const MAV_TYPES: Record<string, string> = {
  Copter: 'Copter',
  HELICOPTER: 'Heli',
  FIXED_WING: 'Plane',
  GROUND_ROVER: 'Rover',
  SUBMARINE: 'Sub',
  ANTENNA_TRACKER: 'Antenna Tracker',
  Blimp: 'Blimp',
  CAN_PERIPHERAL: 'AP Periph',
}

/**
 * The vehicles the app's screens are built for.
 *
 * Anything else flashes fine, but the curated tabs, `takeoffStyle`, the
 * mission catalog and the tuning matrices are Copter and Plane knowledge.
 * HELICOPTER is included because its firmware is ArduCopter.
 */
const TUNED_FOR = new Set(['Copter', 'HELICOPTER', 'FIXED_WING'])

/** Whether the app's own screens understand this vehicle. */
export function isTunedFor(vehicle: string): boolean {
  return TUNED_FOR.has(vehicle)
}

/**
 * The vehicle choices, known without the manifest, so the screen can draw
 * them before the ~97,000-entry download finishes. `vehiclesIn` adds any
 * vehicle the manifest has that this list does not.
 */
export const VEHICLES: { vehicle: string; label: string }[] = Object.entries(MAV_TYPES).map(
  ([vehicle, label]) => ({ vehicle, label }),
)

interface ManifestEntry {
  vehicletype?: string
  platform?: string
  url?: string
  format?: string
  board_id?: number
  bootloader_str?: string[]
  brand_name?: string
  'mav-type'?: string
  'mav-firmware-version'?: string
  'mav-firmware-version-type'?: string
}

const MANIFEST_URL = 'https://firmware.ardupilot.org/manifest.json.gz'

/**
 * `mav-firmware-version-type` has four shapes: `OFFICIAL` (the `/stable/`
 * path), `BETA`, `DEV`, and `STABLE-x.y.z` for every past release. The last
 * is most of the flashable rows, and is what a downgrade needs.
 */
function classify(type: string): { channel: FirmwareOption['channel']; current: boolean } | null {
  if (type === 'OFFICIAL') return { channel: 'stable', current: true }
  if (type.startsWith('STABLE-')) return { channel: 'stable', current: false }
  if (type === 'BETA') return { channel: 'beta', current: false }
  if (type === 'DEV') return { channel: 'dev', current: false }
  return null
}

let cache: FirmwareOption[] | null = null

export function manifestAvailable(): boolean {
  return typeof window !== 'undefined' && window.loftgcs !== undefined
}

export async function loadFirmwareManifest(): Promise<FirmwareOption[]> {
  if (cache) return cache
  const bridge = window.loftgcs
  if (!bridge) throw new Error('firmware browsing needs the desktop app (CORS)')
  const gz = await bridge.app.fetchFirmware(MANIFEST_URL)
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  const json = (await new Response(stream).json()) as { firmware?: ManifestEntry[] }

  const options: FirmwareOption[] = []
  for (const e of json.firmware ?? []) {
    // Only .apj builds (the flashable format) on a recognized channel.
    const kind = classify(e['mav-firmware-version-type'] ?? '')
    if (e.format !== 'apj' || !kind) continue
    const mavType = e['mav-type']
    if (!mavType || !e.platform || !e.url) continue
    // A board id of 0 means "not stated", and most non-apj rows have none.
    // Neither can be matched to a board.
    if (typeof e.board_id !== 'number' || e.board_id === 0) continue
    options.push({
      vehicle: mavType,
      vehicleLabel: MAV_TYPES[mavType] ?? mavType,
      channel: kind.channel,
      current: kind.current,
      platform: e.platform,
      version: e['mav-firmware-version'] ?? '',
      url: e.url,
      boardId: e.board_id,
      bootloaderStr: e.bootloader_str ?? [],
      brandName: e.brand_name ?? null,
    })
  }
  cache = dropPinnedTwins(options)
  return cache
}

/**
 * Drop the pinned copy of the release `/stable/` already serves.
 *
 * `Copter/stable/CubeOrange` and `Copter/stable-4.7.1/CubeOrange` are the
 * same build listed twice; the `/stable/` one is kept. Boards with no pinned
 * twin are left alone.
 *
 * Exported for its test.
 */
export function dropPinnedTwins(options: FirmwareOption[]): FirmwareOption[] {
  const key = (o: FirmwareOption) => `${o.boardId}|${o.vehicle}|${o.platform}|${o.version}`
  const currentKeys = new Set(options.filter((o) => o.current).map(key))
  // Only a stable row can be a twin: ArduPilot cuts beta and stable at the
  // same version number, so without the channel test `beta 4.7.1` would
  // collide with `stable 4.7.1`.
  return options.filter((o) => o.current || o.channel !== 'stable' || !currentKeys.has(key(o)))
}

/**
 * Newest first. Compares numerically per segment, since "4.10.0" sorts
 * before "4.9.0" as a string.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

const CHANNEL_ORDER: Record<FirmwareOption['channel'], number> = { stable: 0, beta: 1, dev: 2 }

/** Every build of one vehicle for one board, newest and most stable first. */
export function releasesFor(
  all: FirmwareOption[],
  vehicle: string,
  platform: string,
  boardId: number | null = null,
): FirmwareOption[] {
  return all
    .filter(
      (o) =>
        o.vehicle === vehicle &&
        o.platform === platform &&
        (boardId === null || o.boardId === boardId),
    )
    .sort(
      (a, b) =>
        CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel] ||
        compareVersions(a.version, b.version),
    )
}

/**
 * The release to offer by default: the current stable.
 *
 * Read from the `current` flag rather than the head of a version-sorted list,
 * because `/stable/` is authoritative and some rows report a version that
 * disagrees with their directory (Rover's stable-3.4.2 reports 3.5.0).
 *
 * Falls back through beta to dev because Blimp has never had a stable
 * release.
 */
export function defaultRelease(releases: FirmwareOption[]): FirmwareOption | undefined {
  return releases.find((o) => o.current) ?? releases[0]
}

/**
 * The vehicles to offer, in the order they are offered.
 *
 * Declaration order of `MAV_TYPES`, not alphabetical, so the common
 * airframes come first. Seeded with the static list so the grid does not
 * reorder when the manifest arrives.
 */
export function vehiclesIn(all: FirmwareOption[]): { vehicle: string; label: string }[] {
  const seen = new Map<string, string>(VEHICLES.map((v) => [v.vehicle, v.label]))
  for (const o of all) seen.set(o.vehicle, o.vehicleLabel)
  const order = Object.keys(MAV_TYPES)
  return [...seen]
    .sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      // Vehicles not in MAV_TYPES sort last, not first as indexOf's -1 would.
      return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib)
    })
    .map(([vehicle, label]) => ({ vehicle, label }))
}

/** One offered release: a version and the channel it came from. */
export interface ReleaseChoice {
  version: string
  channel: FirmwareOption['channel']
  current: boolean
}

/**
 * The releases a vehicle has, independent of the board.
 *
 * ArduPilot cuts a release across every board, so the version can be chosen
 * before the board is known and resolved against it at flash time.
 */
export function versionsFor(all: FirmwareOption[], vehicle: string): ReleaseChoice[] {
  const seen = new Map<string, ReleaseChoice>()
  for (const o of all) {
    if (o.vehicle !== vehicle) continue
    const key = `${o.version}|${o.channel}`
    const had = seen.get(key)
    // `current` is true for the group if any board's row says so.
    if (had) had.current ||= o.current
    else seen.set(key, { version: o.version, channel: o.channel, current: o.current })
  }
  return [...seen.values()].sort(
    (a, b) =>
      CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel] || compareVersions(a.version, b.version),
  )
}

/**
 * Every build target, for a board that cannot identify itself.
 *
 * DFU has no board id and the target is chosen before the vehicle, so this
 * covers the whole catalog, with the same current-first fallback as
 * `platformsFor`.
 */
export function allPlatforms(all: FirmwareOption[]): string[] {
  const live = new Set(all.filter((o) => o.current).map((o) => o.platform))
  const every = new Set(all.map((o) => o.platform))
  return [...(live.size > 0 ? live : every)].sort()
}

/** The matching bootloader-included image for DFU, by naming convention. */
export function withBootloaderUrl(apjUrl: string): string {
  return apjUrl.replace(/\.apj$/, '_with_bl.hex')
}

/** Every option for one board id. */
export function optionsForBoard(all: FirmwareOption[], boardId: number): FirmwareOption[] {
  return all.filter((o) => o.boardId === boardId)
}

/**
 * The boards a vehicle can be flashed onto, narrowed to a detected board.
 *
 * Only `current` rows decide the list, so dropped platforms do not appear
 * beside live ones. A board with no current build for this vehicle falls
 * back to every release it ever had, rather than an empty list.
 */
export function platformsFor(
  all: FirmwareOption[],
  vehicle: string,
  boardId: number | null,
): string[] {
  const mine = all.filter(
    (o) => o.vehicle === vehicle && (boardId === null || o.boardId === boardId),
  )
  const live = mine.filter((o) => o.current)
  return [...new Set((live.length > 0 ? live : mine).map((o) => o.platform))].sort()
}

/**
 * The build to use for a detected board, or null when it is a real choice.
 *
 * A CubeOrange+ fits three builds: `CubeOrangePlus`, `CubeOrangePlus-bdshot`
 * and `CubeOrangePlus-SimOnHardWare`. Where every candidate is the shortest
 * plus a suffix, the rest are opt-in variants of it (`-bdshot` is
 * bidirectional DShot, `-SimOnHardWare` runs SITL on the board), so the plain
 * build is chosen. Where they share no prefix (board id 9 is CubePurple,
 * Pixhawk1 and fmuv3) the caller has to ask. `describeBoard` makes the same
 * test.
 */
export function preferredPlatform(
  all: FirmwareOption[],
  vehicle: string,
  boardId: number,
): string | null {
  const fits = platformsFor(all, vehicle, boardId)
  if (fits.length === 0) return null
  if (fits.length === 1) return fits[0]!
  const shortest = fits.reduce((a, b) => (a.length <= b.length ? a : b))
  return fits.every((p) => p.startsWith(shortest)) ? shortest : null
}

/**
 * What to call a board we have only the id for.
 *
 * The manifest's `brand_name` where there is one, else the platform. Where a
 * board id covers several variants of one platform, the shared prefix is
 * used, so id 140 reads "CubeOrange".
 */
export function describeBoard(all: FirmwareOption[], boardId: number): string | null {
  const mine = optionsForBoard(all, boardId)
  if (mine.length === 0) return null
  const brands = [...new Set(mine.map((o) => o.brandName).filter((b): b is string => !!b))]
  if (brands.length === 1) return brands[0]!
  const platforms = [...new Set(mine.map((o) => o.platform))]
  if (platforms.length === 1) return platforms[0]!
  const shortest = platforms.reduce((a, b) => (a.length <= b.length ? a : b))
  return platforms.every((p) => p.startsWith(shortest)) ? shortest : `board id ${boardId}`
}
