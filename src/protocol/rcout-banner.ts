// Which outputs the board drives, and how -- read from the line ArduPilot
// announces at boot.
//
// A flight controller's outputs are wired to hardware timers in groups, and
// every channel in a group must share one protocol: put DShot on output 5 and
// outputs 6, 7 and 8 come with it whether you meant them to or not. That
// grouping is a property of the board, stated in its hwdef and available
// nowhere in the parameter set -- which is why a screen that lets somebody
// choose DShot cannot tell them what else it took with it.
//
// It is in the boot banner. `AP_HAL::RCOutput::get_output_mode_banner` walks
// the real `pwm_group_list` and writes one run per contiguous stretch of
// channels sharing a mode:
//
//   RCOut: PWM:1-4 DShot600:5-8
//   RCOut: PWM:1-8 DShot600:9-12
//   RCOut: PWM:1-4 DShot600:5 PWM:6-8      (a lone channel has no range)
//   RCOut: None                            (nothing configured)
//   RCOut: Initialising                    (asked too early)
//
// `GCS_MAVLINK::send_banner()` sends it as a STATUSTEXT, and this app already
// asks for the banner on the first heartbeat -- the same request that gets the
// `Frame:` line -- so nothing new is requested to read this.
//
// **It only exists on real hardware.** The base
// `AP_HAL::RCOutput::get_output_mode_banner` returns false and only the
// ChibiOS HAL overrides it, so SITL and the demo vehicle say nothing at all
// and `parseRcoutBanner` returns null for every line they send. That is a
// missing banner, not an empty one: a board with no outputs configured says
// "RCOut: None", which is a different answer and parses to an empty group
// list.

/** One run of channels the board drives with the same protocol. */
export interface RcoutGroup {
  /** ArduPilot's own name for the mode: "PWM", "DShot600", "OneShot125". */
  mode: string
  /** First output channel, counting from 1. */
  low: number
  /** Last output channel; equal to `low` for a lone one. */
  high: number
}

export interface RcoutBanner {
  groups: RcoutGroup[]
  /**
   * The board answered before its outputs were up.
   *
   * Worth keeping apart from "no groups": one says ask again, the other says
   * there is nothing to show.
   */
  initialising: boolean
}

/**
 * Read the `RCOut:` line, or null if this is not one.
 *
 * Null for any other status text, so a caller can pass the whole feed through
 * it -- which is what the store does, the same way it does for `Frame:`.
 */
export function parseRcoutBanner(line: string): RcoutBanner | null {
  const m = /\bRCOut:\s*(.*)$/i.exec(line.trim())
  if (!m) return null
  const rest = (m[1] ?? '').trim()
  if (/^initiali[sz]ing$/i.test(rest)) return { groups: [], initialising: true }
  if (/^none$/i.test(rest) || rest === '') return { groups: [], initialising: false }

  const groups: RcoutGroup[] = []
  // A mode name is whatever is not a colon or a space: ArduPilot's own strings
  // include digits ("DShot600") and letters both ways, so matching a known set
  // here would silently drop a mode added upstream.
  for (const g of rest.matchAll(/([^\s:]+):(\d+)(?:-(\d+))?/g)) {
    const low = Number(g[2])
    const high = g[3] === undefined ? low : Number(g[3])
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) continue
    groups.push({ mode: g[1]!, low, high })
  }
  return groups.length > 0 ? { groups, initialising: false } : null
}

/** Which group a given output channel falls in, or null. */
export function groupForChannel(banner: RcoutBanner | null, channel: number): RcoutGroup | null {
  return banner?.groups.find((g) => channel >= g.low && channel <= g.high) ?? null
}

/**
 * The board's short name, from the same boot banner.
 *
 * ArduPilot prints it with the MCU's unique id --
 * `"%s %02X%02X%02X%02X %02X%02X%02X%02X %02X%02X%02X%02X"` in ChibiOS's
 * `Util::get_system_id` -- so the line looks like:
 *
 *   CubeOrange 00340036 3137510B 33393538
 *
 * The name is `CHIBIOS_SHORT_BOARD_NAME`, which is also what the hwdef tree is
 * keyed by, so it is what identifies a board's timer groups. The three
 * eight-digit words are what make this line recognisable: no other banner line
 * has that shape, and matching on the name alone would catch the firmware
 * string. The first token must not end in a colon, which is what separates it
 * from the `IOMCU: 12 34 5678` line above it.
 */
export function boardNameFromBanner(line: string): string | null {
  const m = /^(\S+?)\s+[0-9A-F]{8}\s+[0-9A-F]{8}\s+[0-9A-F]{8}\s*$/i.exec(line.trim())
  return m && !m[1]!.endsWith(':') ? m[1]! : null
}
