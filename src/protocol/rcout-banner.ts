// Which outputs the board drives, and how, read from ArduPilot's boot banner.
//
// Outputs are wired to hardware timers in groups, and every channel in a
// group shares one protocol: DShot on output 5 brings 6, 7 and 8 with it. The
// grouping is in the board's hwdef, not in the parameter set, but
// `AP_HAL::RCOutput::get_output_mode_banner` walks `pwm_group_list` and
// writes one run per contiguous stretch of channels sharing a mode:
//
//   RCOut: PWM:1-4 DShot600:5-8
//   RCOut: PWM:1-8 DShot600:9-12
//   RCOut: PWM:1-4 DShot600:5 PWM:6-8      (a lone channel has no range)
//   RCOut: None                            (nothing configured)
//   RCOut: Initialising                    (asked too early)
//
// `GCS_MAVLINK::send_banner()` sends it as STATUSTEXT, in the same banner
// the app already requests for the `Frame:` line.
//
// Only real hardware sends it: the base implementation returns false and
// only the ChibiOS HAL overrides it, so SITL and the demo vehicle yield null.
// A board with no outputs configured says "RCOut: None", which parses to an
// empty group list instead.

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
  /** The board answered before its outputs were up; ask again later. */
  initialising: boolean
}

/**
 * Read the `RCOut:` line, or null for any other status text, so the whole
 * feed can be passed through it.
 */
export function parseRcoutBanner(line: string): RcoutBanner | null {
  const m = /\bRCOut:\s*(.*)$/i.exec(line.trim())
  if (!m) return null
  const rest = (m[1] ?? '').trim()
  if (/^initiali[sz]ing$/i.test(rest)) return { groups: [], initialising: true }
  if (/^none$/i.test(rest) || rest === '') return { groups: [], initialising: false }

  const groups: RcoutGroup[] = []
  // Any mode name is accepted, so a mode added upstream is not dropped.
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
 * ChibiOS's `Util::get_system_id` prints it with the MCU's unique id:
 *
 *   CubeOrange 00340036 3137510B 33393538
 *
 * The name is `CHIBIOS_SHORT_BOARD_NAME`, which keys the hwdef tree. The
 * three eight-digit words identify the line; a first token ending in a colon
 * is the `IOMCU:` line instead.
 */
export function boardNameFromBanner(line: string): string | null {
  const m = /^(\S+?)\s+[0-9A-F]{8}\s+[0-9A-F]{8}\s+[0-9A-F]{8}\s*$/i.exec(line.trim())
  return m && !m[1]!.endsWith(':') ? m[1]! : null
}
