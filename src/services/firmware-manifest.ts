// Official-firmware index from firmware.ardupilot.org/manifest.json.gz.
// That host sends no CORS headers, so this only works where the Electron
// main-process fetch bridge exists; the browser build offers file loading
// and a link-out instead.

export interface FirmwareOption {
  /** `mav-type`, the real discriminator -- see MAV_TYPES below. */
  vehicle: string
  /** What to call `vehicle` on screen. */
  vehicleLabel: string
  channel: 'stable' | 'beta' | 'dev'
  /**
   * True only for the row ArduPilot's own `/stable/` path serves.
   *
   * The manifest carries every release ever published, so "stable" alone is
   * forty-odd builds for a board. This marks the one the project currently
   * points at, which is what a version is defaulted to.
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
 * `mav-type`, not `vehicletype`, and this is not cosmetic.
 *
 * `vehicletype: "Copter"` covers *both* multirotors and traditional helis --
 * 14,708 rows that `mav-type` splits into Copter (7,427) and HELICOPTER
 * (7,281), which are different firmware images. Keyed on `vehicletype` this
 * app offered a heli build and a multirotor build under one name and picked
 * whichever sorted first, which is a wrong image flashed silently.
 *
 * It is also the key Mission Planner joins on, and the reason its detection
 * resolves: measured against the live manifest, board id x mav-type x
 * channel is exactly one row for 198 of 317 boards, several for 32 and none
 * for 87. Keyed on `vehicletype` instead it is *never* exactly one, because
 * the heli twin is always there beside it.
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
 * The airframes the rest of this app was built and tested against.
 *
 * Everything else flashes perfectly well -- the manifest and the bootloader
 * do not care what the aircraft is -- but the screens downstream do: the
 * curated tabs, `takeoffStyle`, the mission catalog and the tuning matrices
 * are all Copter-or-Plane knowledge. Flashing a Rover leaves someone with a
 * working vehicle and a ground station that is guessing, which is worth
 * saying out loud once rather than discovering a screen at a time.
 *
 * `HELICOPTER` *is* in here: the manifest splits it off `Copter` because the
 * image differs, but the firmware underneath is ArduCopter and the screens
 * this warning is about are the same ones. It was outside the set on the
 * grounds that nothing here had been flown against a heli -- which is also
 * true of most multirotors, and is not what the line says. A warning shown
 * on a vehicle this app does understand is the kind that teaches people to
 * read past the ones that matter.
 */
const TUNED_FOR = new Set(['Copter', 'HELICOPTER', 'FIXED_WING'])

/** Whether the app's own screens understand this vehicle. */
export function isTunedFor(vehicle: string): boolean {
  return TUNED_FOR.has(vehicle)
}

/**
 * The vehicle choices, known without the manifest.
 *
 * The grid used to be derived from the downloaded manifest, which meant the
 * eight symbols -- the first thing on the screen and the one question the
 * user has to answer before anything else can happen -- waited on a 97,000
 * entry download and parse. The vehicles ArduPilot builds are not a fact
 * about today's manifest, so the list is static and the screen draws
 * immediately; `vehiclesIn` folds in anything the manifest gains that this
 * file has not learned.
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
 * `mav-firmware-version-type` has four shapes, not three, and the fourth is
 * most of the file: `OFFICIAL` (the `/stable/` path), `BETA`, `DEV`, and
 * `STABLE-4.6.3` for every release ever published. Reading only the first
 * three threw away 28,143 of the 33,915 flashable rows -- every firmware
 * older than today's, which is exactly what someone downgrading is after.
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
    // Only current-channel .apj builds: the flashable format, deduplicated
    // from the ~90k historical entries.
    const kind = classify(e['mav-firmware-version-type'] ?? '')
    if (e.format !== 'apj' || !kind) continue
    const mavType = e['mav-type']
    if (!mavType || !e.platform || !e.url) continue
    // A board id of 0 is "not stated", not board zero, and 65% of the
    // manifest has no id at all (every hex/elf/bin row). Both are useless
    // for matching a board and would poison the join.
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
 * same build listed twice -- 1,683 of the 1,786 current rows -- and the
 * `/stable/` one is kept because it is what ArduPilot itself publishes as
 * current. The 103 without a twin are boards whose pinned directory was
 * never cut, and they stay.
 *
 * Exported for its test: it is a filter over the whole option list, and the
 * one mistake it can make is invisible in the result -- a row that should
 * have survived is simply not there.
 */
export function dropPinnedTwins(options: FirmwareOption[]): FirmwareOption[] {
  const key = (o: FirmwareOption) => `${o.boardId}|${o.vehicle}|${o.platform}|${o.version}`
  const currentKeys = new Set(options.filter((o) => o.current).map(key))
  // Only a *stable* row can be the current release's twin. Leaving the
  // channel out of this test looked right and quietly dropped all 1,787
  // beta rows, because ArduPilot cuts beta and stable at the same version
  // number -- so `beta 4.7.1` collided with `stable 4.7.1` and lost.
  return options.filter((o) => o.current || o.channel !== 'stable' || !currentKeys.has(key(o)))
}

/**
 * Newest first. Compares numerically per segment, because "4.10.0" sorts
 * before "4.9.0" as a string and a downgrade list that puts them the wrong
 * way round offers the wrong firmware at the top.
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
 * What to offer without being asked: the current stable.
 *
 * Read from the `current` flag rather than taken as the head of a
 * version-sorted list. Those agree for every board in the manifest as it
 * stands -- measured, zero groups disagree -- but they agree by coincidence:
 * `/stable/` is authoritative about which release is current, where the
 * ordering is only a fact about version strings, and the manifest already
 * carries rows whose reported version disagrees with the directory serving
 * them (Rover's stable-3.4.2 reports 3.5.0). If those two ever part company
 * the flag is the one to believe.
 *
 * Falling back through beta to dev is not a nicety -- Blimp has never had a
 * stable release and exists only on `dev`, so a strict "current stable or
 * nothing" leaves one of the eight vehicle choices permanently empty.
 */
export function defaultRelease(releases: FirmwareOption[]): FirmwareOption | undefined {
  return releases.find((o) => o.current) ?? releases[0]
}

/**
 * The vehicles to offer, in the order they are offered.
 *
 * Declaration order of `MAV_TYPES`, not alphabetical: the grid should open
 * with the airframes most people are flashing and end with the two that are
 * not really airframes at all. Alphabetical put "Antenna Tracker" first.
 *
 * Seeded with the static eight so this answers the same before and after the
 * manifest arrives -- the grid must not gain or reorder symbols under
 * somebody's cursor once the download lands.
 */
export function vehiclesIn(all: FirmwareOption[]): { vehicle: string; label: string }[] {
  const seen = new Map<string, string>(VEHICLES.map((v) => [v.vehicle, v.label]))
  for (const o of all) seen.set(o.vehicle, o.vehicleLabel)
  const order = Object.keys(MAV_TYPES)
  return [...seen]
    .sort((a, b) => {
      const ia = order.indexOf(a[0])
      const ib = order.indexOf(b[0])
      // Anything the manifest gains that MAV_TYPES has not learned sorts
      // last rather than first, which is what indexOf's -1 would do.
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
 * A release is a thing ArduPilot cuts across every board it supports, so the
 * version is a property of the firmware and not of the hardware -- which
 * matters here because the board is no longer known when this list is drawn.
 * It used to be `releasesFor(vehicle, platform)`, and once the board stopped
 * being asked for up front that meant an empty list, a permanently disabled
 * control, and "No build for this board" on a screen where no board had been
 * named. The version is chosen here and resolved against the board at flash
 * time, which is the only moment both are known.
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
 * Every build target there is, for a board that cannot say which it is.
 *
 * DFU has no board id, and the target is asked for before a vehicle is
 * chosen, so this is the whole catalog rather than one vehicle's slice:
 * current builds where a platform has one, every release it ever had where
 * it does not, the same fallback `platformsFor` makes.
 */
export function allPlatforms(all: FirmwareOption[]): string[] {
  const live = new Set(all.filter((o) => o.current).map((o) => o.platform))
  const every = new Set(all.map((o) => o.platform))
  return [...(live.size > 0 ? live : every)].sort()
}

/** The matching bootloader-included image for DFU recovery, by convention. */
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
 * Only `current` rows decide the list: a platform that existed in 4.3 and
 * was dropped is not a board anyone is holding, and putting a dead variant
 * beside a live one is a choice nobody can make correctly. A board with no
 * current build for this vehicle falls back to every release it ever had --
 * 87 of 317 board ids have no build at all on some vehicle, and an empty
 * list would read as "this app does not know your board" when the truth is
 * that this vehicle was dropped from it.
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
 * `platformsFor` answers "what fits", which is not the same question. A
 * CubeOrange+ fits three: `CubeOrangePlus`, `CubeOrangePlus-bdshot` and
 * `CubeOrangePlus-SimOnHardWare`. Treating that as ambiguous meant one of
 * the commonest boards on the bench asked which build it was every single
 * time -- measured against the live manifest with a Cube Orange+ actually
 * plugged in, which is how this was found; nothing in the unit tests could
 * see it.
 *
 * The distinction that matters is variants-of-one-board versus
 * different-boards-sharing-an-id, and it is the same test `describeBoard`
 * already makes. Where every candidate is the shortest one plus a suffix,
 * the shortest is the plain build and the rest are opt-in variants
 * (`-bdshot` is bidirectional DShot; `-SimOnHardWare` is SITL running on the
 * board, which nobody flying wants), so the plain build is chosen. Where
 * they share no prefix -- board id 9 is CubePurple *and* Pixhawk1 *and*
 * fmuv3, genuinely different hardware -- there is no safe pick and the
 * caller has to ask.
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
 * board id covers several platforms the shared prefix is used, so id 140
 * reads "CubeOrange" rather than picking one of CubeOrange,
 * CubeOrange-bdshot and CubeOrange-SimOnHardWare and implying the board is
 * that variant.
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
