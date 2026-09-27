// Answers a serial port request without asking, when the answer is not in
// doubt. Kept pure and out of main.ts so it can be tested: the port it picks
// is about to have firmware written to it.

/** The fields the decision turns on; Electron's PortInfo has more. */
export interface PortLike {
  portId: string
  /**
   * The USB product string, on Windows.
   *
   * These are `| undefined` as well as optional because
   * `exactOptionalPropertyTypes` is on and the caller spreads Chromium's
   * objects, where each field is `string | undefined`.
   */
  displayName?: string | undefined
  /** Windows' friendly name for the port, from serial-names.ts. */
  driverName?: string | undefined
  vendorId?: string | number | undefined
  productId?: string | number | undefined
}

/**
 * Electron builds `vendorId`/`productId` strings from Chromium's uint16s, so
 * they arrive in decimal ("4617", not "1209"). An all-digit string is read as
 * decimal; one containing a-f can only be hex.
 */
const num = (v: string | number | undefined) => {
  if (typeof v === 'number') return v
  if (!v) return NaN
  return /[a-f]/i.test(v) ? Number.parseInt(v, 16) : Number(v)
}

const BL_NAME = /-BL\b|bootloader/i
/** Interface names a flight controller gives its non-bootloader ports. */
const NOT_BL_NAME = /mavlink|slcan|telem/i

/**
 * Whether a port is an ArduPilot bootloader, from what it calls itself.
 *
 * An ArduPilot bootloader's USB product string is the board's hwdef name with
 * `-BL` appended (the manifest's `bootloader_str`); boards without their own
 * string use the project's generic ids or the older PX4 ones.
 *
 * The driver name overrides the product string. After a Cube reboots into its
 * bootloader, Windows keeps a phantom of the old MAVLink port and Chromium
 * reports its product string as `CubeOrange-BL` too, while the driver still
 * names it "Cube Orange Mavlink".
 */
export function looksLikeBootloader(p: PortLike): boolean {
  if (saysNotBootloader(p)) return false
  if (p.driverName && BL_NAME.test(p.driverName)) return true
  if (BL_NAME.test(p.displayName ?? '')) return true
  const vid = num(p.vendorId)
  const pid = num(p.productId)
  return (vid === 0x1209 && pid === 0x5741) || (vid === 0x26ac && pid === 0x0011)
}

/** A port whose driver name says it is one of a running board's interfaces. */
function saysNotBootloader(p: PortLike): boolean {
  return !!p.driverName && NOT_BL_NAME.test(p.driverName)
}

/**
 * The port to answer a held request with, or null when it is a real choice.
 *
 * A board rebooted into its bootloader re-enumerates as a different USB
 * device, so Chromium asks for permission again. Candidates, in order: the one
 * bootloader-looking port that arrived during this request (it outranks the
 * phantom described above); the one bootloader-looking port in the list; the
 * one port that was not present at the previous request.
 *
 * Each step needs exactly one match. Two candidates means two boards, and
 * picking either would erase a board nobody chose.
 */
export function pickBootloaderPort(
  portList: PortLike[],
  lastIds: ReadonlySet<string>,
  arrivedIds: ReadonlySet<string> = new Set(),
): string | null {
  const bl = portList.filter(looksLikeBootloader)
  const arrivedBl = bl.filter((p) => arrivedIds.has(p.portId))
  if (arrivedBl.length === 1) return arrivedBl[0]!.portId
  if (arrivedBl.length > 1) return null
  if (bl.length === 1) return bl[0]!.portId
  if (bl.length > 1) return null
  // The last resort trusts arrival alone, so it excludes ports the driver
  // names as a running board's interface: a Cube booting its firmware
  // mid-request adds its SLCAN port as the one new arrival.
  return newPortSince(
    portList.filter((p) => !saysNotBootloader(p)),
    lastIds,
  )
}

/** The port that appeared since the last request, if there is exactly one. */
export function newPortSince(portList: PortLike[], lastIds: ReadonlySet<string>): string | null {
  // With no previous list every port looks new, so a single-port machine
  // would auto-pick on the very first ask.
  if (lastIds.size === 0) return null
  const fresh = portList.filter((p) => !lastIds.has(p.portId))
  return fresh.length === 1 ? fresh[0]!.portId : null
}
