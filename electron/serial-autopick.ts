// Answering a port request without asking, when the answer is a fact.
//
// Kept out of main.ts and pure so it can be tested: this chooses a serial
// port on somebody's behalf and then writes firmware to it, which is not a
// decision to leave only to a hand-check of the window.

/** The fields the decision turns on; Electron's PortInfo has more. */
export interface PortLike {
  portId: string
  /**
   * Chromium's name for it: the USB product string, on Windows.
   *
   * These four are `| undefined` as well as optional because
   * `exactOptionalPropertyTypes` is on and the caller builds its ports by
   * spreading Chromium's own objects, where every one of them is genuinely
   * `string | undefined` -- an absent field and a present undefined one are
   * the same thing to every reader here.
   */
  displayName?: string | undefined
  /** Windows' own friendly name for the port, from serial-names.ts. */
  driverName?: string | undefined
  vendorId?: string | number | undefined
  productId?: string | number | undefined
}

/**
 * Electron builds `vendorId`/`productId` strings from Chromium's uint16s, so
 * they arrive **decimal** -- "4617", not "1209" -- and a hex parse of that
 * is a different number entirely. An all-digit string is therefore read as
 * decimal; one carrying a-f can only be hex. The same rule the chooser's
 * own `hex()` helper documents, for the same reason.
 */
const num = (v: string | number | undefined) => {
  if (typeof v === 'number') return v
  if (!v) return NaN
  return /[a-f]/i.test(v) ? Number.parseInt(v, 16) : Number(v)
}

const BL_NAME = /-BL\b|bootloader/i
/** Interface names a flight controller gives its *non*-bootloader ports. */
const NOT_BL_NAME = /mavlink|slcan|telem/i

/**
 * Whether a port is an ArduPilot bootloader, from what it calls itself.
 *
 * Every ArduPilot bootloader announces itself: its USB product string is the
 * board's hwdef name with `-BL` on the end (`CubeOrangePlus-BL`, the same
 * string the manifest carries as `bootloader_str`), and boards without a
 * string of their own use the project's generic ids or the older PX4 ones.
 *
 * **The driver name can veto the product string, and has to.** Measured on
 * the bench with the main process traced: after a Cube reboots into its
 * bootloader, Windows keeps a phantom of the old MAVLink port -- still
 * listed, not openable -- and Chromium re-reads *its* product string as
 * `CubeOrange-BL` too. Two bootloaders by product string; but the driver
 * names them "Cube Orange Mavlink" and "Cube Orange Bootloader", which is
 * the truth. A driver name that says the port is a MAVLink or SLCAN
 * interface is believed over a product string that says bootloader.
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
 * A flash reboots the board into its bootloader, which re-enumerates as a
 * *different* USB device -- so Chromium asks for permission again and the
 * browser's own model has nothing to offer, granting per device. What the
 * desktop shell has instead is the candidate list Chromium hands it on every
 * request, which a web page never sees.
 *
 * Three tests, in order. **A port that arrived while this request was open
 * and looks like a bootloader** is the answer -- it is the thing the reboot
 * produced, and it outranks any lookalike that was already in the list,
 * which after a reboot is the phantom described above. Failing that, **the
 * one port in the whole list that looks like a bootloader**. Failing that,
 * **the one port that was not there at the previous request**, for a
 * bootloader that names itself nothing recognisable.
 *
 * **Exactly one, or nothing**, at every step. Two bootloaders that both
 * arrived is two boards and a choice; picking either is a board chosen
 * silently and then erased, the failure this whole screen is built to avoid.
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
  // The last resort trusts arrival alone, so it takes nothing the driver
  // names as a running board's interface. Measured on the bench: a Cube
  // booting its firmware mid-request added "Cube Orange SLCAN" as the one new
  // port, and this answered with it -- the probe got silence, the reboot went
  // down a CAN link, and the chooser that followed never closed.
  return newPortSince(
    portList.filter((p) => !saysNotBootloader(p)),
    lastIds,
  )
}

/** The port that appeared since the last request, if there is exactly one. */
export function newPortSince(portList: PortLike[], lastIds: ReadonlySet<string>): string | null {
  // With no previous list every port looks new, which is not evidence of
  // anything: a single-port machine would auto-pick on the very first ask.
  if (lastIds.size === 0) return null
  const fresh = portList.filter((p) => !lastIds.has(p.portId))
  return fresh.length === 1 ? fresh[0]!.portId : null
}
