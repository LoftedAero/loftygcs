// The parts of the HUD that are decisions rather than drawing: which ticks a
// tape shows, what the compass ribbon reads at a given heading, and what the
// vehicle's state actually means. Kept out of the canvas so they can be
// tested, because "is this vehicle in failsafe" is not something to get wrong
// on a screen someone flies from.

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
 * EMERGENCY when it is in a terminal state, so those two are the condition --
 * everything below them is ordinary operation.
 */
export function isFailsafe(systemStatus: number): boolean {
  return systemStatus === MAV_STATE.critical || systemStatus === MAV_STATE.emergency
}

export type ArmReadiness = 'armed' | 'ready' | 'notReady' | 'unknown'

/**
 * What to say about arming.
 *
 * The prearm bit only means something when the vehicle says it reports one;
 * a build that never sets it would otherwise read as a permanent "not ready"
 * and train the pilot to ignore the line that matters.
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
 * Generated from a rounded anchor rather than from the live value, so the
 * marks hold still and the tape slides past them. Ticks anchored to the value
 * itself jitter in place at telemetry rate and are unreadable.
 */
export function tapeTicks(value: number, halfSpan: number, step: number, majorEvery = 2): Tick[] {
  const ticks: Tick[] = []
  const lo = Math.ceil((value - halfSpan) / step) * step
  const hi = value + halfSpan
  for (let v = lo; v <= hi; v += step) {
    // Rounded because floating point accumulation turns 0 into 1e-15, which
    // then prints as "0" but fails an equality check on the major test.
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
 * Cardinal points win over the number at the same bearing, which is how every
 * HUD does it and how a pilot reads "SW" rather than "225".
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
  // -1 is "the vehicle has no estimate", which is different from a flat pack.
  if (pct >= 0) parts.push(`${Math.round(pct)}%`)
  return parts.join('  ')
}

/**
 * GPS fix quality, in the words a pilot uses for it.
 *
 * The fix type is what decides whether the aircraft can hold a position at
 * all, so it leads; the satellite count is the number that moves while you
 * wait for it, so it follows. GPS_FIX_TYPE from MAVLink: below 2 there is no
 * position, 3 is the ordinary one, and the RTK types matter enough to name
 * because someone who has set up an RTK base wants to see it took.
 */
export function gpsLabel(fixType: number, sats: number): string {
  const kind =
    fixType >= 6
      ? 'RTK fixed'
      : fixType === 5
        ? 'RTK float'
        : fixType === 4
          ? 'DGPS'
          : fixType === 3
            ? '3D'
            : fixType === 2
              ? '2D'
              : 'No fix'
  // Satellites only once there are some to count: "No fix 0" says the same
  // thing twice, and a receiver that has not reported yet says nothing.
  // Named, because the line opposite says "RSSI 83%" and "28 pkt/s" -- a
  // bare number among labelled ones is the one a reader has to stop at.
  return sats > 0 ? `GPS ${kind}  ${sats} sats` : `GPS ${kind}`
}

/**
 * Whether the fix is one a position-holding mode can fly on.
 *
 * Three is the threshold ArduPilot itself uses: below it the vehicle refuses
 * Loiter, Auto and RTL, which is exactly when a pilot wants the number to be
 * shouting rather than sitting quietly in a corner.
 */
export function gpsUsable(fixType: number): boolean {
  return fixType >= 3
}

/** Link line: receiver RSSI where the vehicle reports it, else packet rate. */
export function linkLabel(rcRssi: number, packetsPerSec: number | undefined): string {
  const parts: string[] = []
  // RC_CHANNELS carries RSSI as 0-254; a percentage is what people read.
  if (rcRssi >= 0) parts.push(`RSSI ${Math.round((rcRssi / 254) * 100)}%`)
  if (packetsPerSec !== undefined && packetsPerSec > 0) {
    parts.push(`${packetsPerSec.toFixed(0)} pkt/s`)
  }
  return parts.join('  ')
}

/**
 * How far apart a tape's labelled ticks sit, in the unit being shown.
 *
 * A tape spans seven steps, so the step decides how much sky the pilot sees
 * at once. Ten meters of altitude and ten feet are not the same amount of
 * sky, so the number has to change with the unit or the imperial tape
 * scrolls three times too fast to read.
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
