// The parts of the HUD that are decisions rather than drawing: which ticks a
// tape shows, what the compass ribbon reads at a heading, and what the
// vehicle's state means. Kept out of the canvas so they can be tested.

/** MAV_STATE values. Only the ones that mean something to a pilot. */
export const MAV_STATE = {
  standby: 3,
  active: 4,
  critical: 5,
  emergency: 6,
} as const

/**
 * Whether the heartbeat is reporting a failsafe.
 *
 * ArduPilot raises the system status to CRITICAL when a failsafe triggers and
 * EMERGENCY in a terminal state.
 */
export function isFailsafe(systemStatus: number): boolean {
  return systemStatus === MAV_STATE.critical || systemStatus === MAV_STATE.emergency
}

export type ArmReadiness = 'armed' | 'ready' | 'notReady' | 'unknown'

/**
 * What to say about arming.
 *
 * The prearm health bit only counts when the present mask says the vehicle
 * reports it; otherwise a build that never sets it would always read "not
 * ready".
 */
export function armReadiness(
  armed: boolean,
  sensorsPresent: number,
  sensorsHealth: number,
  prearmBit: number,
): ArmReadiness {
  if (armed) return 'armed'
  if ((sensorsPresent & prearmBit) === 0) return 'unknown'
  return (sensorsHealth & prearmBit) !== 0 ? 'ready' : 'notReady'
}

export interface Tick {
  /** The value this tick marks. */
  value: number
  /** Where it sits relative to the center, in tick-units above center. */
  offset: number
  /** Major ticks carry a number; minor ticks are just a line. */
  major: boolean
}

/**
 * Ticks for a vertical tape centered on `value`.
 *
 * Generated from a rounded anchor rather than the live value, so the marks
 * hold still and the tape slides past them instead of jittering.
 */
export function tapeTicks(value: number, halfSpan: number, step: number, majorEvery = 2): Tick[] {
  const ticks: Tick[] = []
  const lo = Math.ceil((value - halfSpan) / step) * step
  const hi = value + halfSpan
  for (let v = lo; v <= hi; v += step) {
    // Rounded because floating-point accumulation turns 0 into 1e-15, which
    // fails the major-tick test.
    const n = Math.round(v / step)
    ticks.push({ value: n * step, offset: n * step - value, major: n % majorEvery === 0 })
  }
  return ticks
}

const CARDINALS: [number, string][] = [
  [0, 'N'],
  [45, 'NE'],
  [90, 'E'],
  [135, 'SE'],
  [180, 'S'],
  [225, 'SW'],
  [270, 'W'],
  [315, 'NW'],
]

export interface CompassTick {
  /** Degrees from the center of the ribbon, negative to the left. */
  offset: number
  label: string
  major: boolean
}

/** Shortest signed angle from a to b, in degrees. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180
}

/**
 * Labels for the compass ribbon around a heading.
 *
 * Cardinal points replace the number at the same bearing ("SW", not "225").
 */
export function compassTicks(heading: number, halfSpanDeg: number, step = 15): CompassTick[] {
  const out: CompassTick[] = []
  const center = Math.round(heading / step) * step
  const reach = Math.ceil(halfSpanDeg / step) * step
  for (let d = center - reach; d <= center + reach; d += step) {
    const bearing = ((d % 360) + 360) % 360
    const offset = angleDelta(heading, d)
    if (Math.abs(offset) > halfSpanDeg) continue
    const cardinal = CARDINALS.find(([deg]) => deg === bearing)
    out.push({
      offset,
      label: cardinal ? cardinal[1] : String(bearing),
      major: bearing % 30 === 0,
    })
  }
  return out
}

/** Battery line, skipping the fields the vehicle is not reporting. */
export function batteryLabel(volts: number, amps: number, pct: number): string {
  const parts: string[] = []
  if (volts > 0) parts.push(`${volts.toFixed(1)}V`)
  if (amps > 0) parts.push(`${amps.toFixed(1)}A`)
  // -1 means the vehicle has no estimate, which is not a flat pack.
  if (pct >= 0) parts.push(`${Math.round(pct)}%`)
  return parts.join('  ')
}

/**
 * GPS fix quality, from MAVLink's GPS_FIX_TYPE.
 *
 * 0 (NO_GPS) and 1 (NO_FIX) are kept apart, as Mission Planner does: the
 * first means no receiver is talking to the autopilot (wiring or port
 * configuration), the second a receiver still searching. The RTK types are
 * named so an RTK setup can be confirmed.
 */
export function gpsKind(fixType: number): string {
  return fixType >= 6
    ? 'RTK fixed'
    : fixType === 5
      ? 'RTK float'
      : fixType === 4
        ? 'DGPS'
        : fixType === 3
          ? '3D'
          : fixType === 2
            ? '2D'
            : fixType === 1
              ? 'No fix'
              : 'No GPS'
}

export function gpsLabel(fixType: number, sats: number): string {
  const kind = gpsKind(fixType)
  // Satellite count only when nonzero, and labeled like the link line's
  // values.
  return sats > 0 ? `GPS: ${kind}  ${sats} sats` : `GPS: ${kind}`
}

/**
 * Whether the fix is one a position-holding mode can fly on.
 *
 * 3D is ArduPilot's own threshold: below it the vehicle refuses Loiter, Auto
 * and RTL.
 */
export function gpsUsable(fixType: number): boolean {
  return fixType >= 3
}

/** Link line: receiver RSSI where the vehicle reports it, else packet rate. */
export function linkLabel(rcRssi: number, packetsPerSec: number | undefined): string {
  const parts: string[] = []
  // RC_CHANNELS carries RSSI as 0-254; shown as a percentage.
  if (rcRssi >= 0) parts.push(`RSSI ${Math.round((rcRssi / 254) * 100)}%`)
  if (packetsPerSec !== undefined && packetsPerSec > 0) {
    parts.push(`${packetsPerSec.toFixed(0)} pkt/s`)
  }
  return parts.join('  ')
}

/**
 * How far apart a tape's labeled ticks sit, in the unit being shown. A tape
 * spans seven steps, so the step changes with the unit or an imperial tape
 * scrolls three times too fast.
 */
export function tapeStep(kind: 'speed' | 'altitude', unit: string): number {
  if (kind === 'altitude') return unit === 'ft' ? 25 : 10
  switch (unit) {
    case 'kmh':
      return 20
    case 'kts':
    case 'mph':
      return 10
    default:
      return 5
  }
}

/** MAV_SEVERITY_WARNING: this and everything more severe reaches the HUD. */
export const HUD_MESSAGE_SEVERITY = 4
/** How long a message stays on the HUD. */
export const HUD_MESSAGE_MS = 8000

/**
 * The one message the HUD shows, or null: the newest of the vehicle's
 * warnings and the app's own note about a command, while it is recent.
 *
 * Warning severity and worse only, since the vehicle also reports routine
 * events such as every waypoint reached. The full feed is in the Messages
 * pane.
 */
export function hudMessage(
  statusTexts: readonly { severity: number; text: string; at: number }[],
  note: { text: string; at: number } | null,
  now: number,
): string | null {
  let newest: { text: string; at: number } | null = note
  for (let i = statusTexts.length - 1; i >= 0; i--) {
    const t = statusTexts[i]!
    if (t.severity > HUD_MESSAGE_SEVERITY) continue
    if (!newest || t.at > newest.at) newest = t
    break
  }
  return newest && now - newest.at < HUD_MESSAGE_MS ? newest.text : null
}
