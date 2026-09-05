// Turning the vehicle's numbers into the reader's units.
//
// Everything inside this app is SI, because MAVLink is: meters, meters per
// second, radians. That never changes -- conversion happens at the edge, on
// the way to a screen and on the way back from a keyboard, and nothing in
// between ever holds feet. A units bug that reaches a mission altitude is a
// flying-into-terrain bug, so the canonical value is the one in the store
// and the converted one is always derived.
//
// Kept dependency-free and outside src/protocol so both the renderer and any
// future consumer can use it, in the same spirit as src/sim-home.ts.

export type DistanceUnit = 'm' | 'ft'
export type SpeedUnit = 'ms' | 'kmh' | 'kts' | 'mph'

export interface UnitPrefs {
  distance: DistanceUnit
  speed: SpeedUnit
}

export const DEFAULT_UNITS: UnitPrefs = { distance: 'm', speed: 'ms' }

/** The international foot, exactly. Everything else derives from it. */
const M_PER_FT = 0.3048
const MS_PER_KMH = 1 / 3.6
/** The international nautical mile is exactly 1852 m. */
const MS_PER_KT = 1852 / 3600
const MS_PER_MPH = (M_PER_FT * 5280) / 3600

const DISTANCE: Record<DistanceUnit, { perUnit: number; label: string }> = {
  m: { perUnit: 1, label: 'm' },
  ft: { perUnit: M_PER_FT, label: 'ft' },
}

const SPEED: Record<SpeedUnit, { perUnit: number; label: string }> = {
  ms: { perUnit: 1, label: 'm/s' },
  kmh: { perUnit: MS_PER_KMH, label: 'km/h' },
  kts: { perUnit: MS_PER_KT, label: 'kts' },
  mph: { perUnit: MS_PER_MPH, label: 'mph' },
}

// ---------------------------------------------------------------- distance

/** Meters to the reader's distance unit. */
export function toDistance(meters: number, unit: DistanceUnit): number {
  return meters / DISTANCE[unit].perUnit
}

/** The reader's distance unit back to meters -- the only value we store. */
export function fromDistance(value: number, unit: DistanceUnit): number {
  return value * DISTANCE[unit].perUnit
}

export function distanceLabel(unit: DistanceUnit): string {
  return DISTANCE[unit].label
}

// ------------------------------------------------------------------- speed

export function toSpeed(ms: number, unit: SpeedUnit): number {
  return ms / SPEED[unit].perUnit
}

export function fromSpeed(value: number, unit: SpeedUnit): number {
  return value * SPEED[unit].perUnit
}

export function speedLabel(unit: SpeedUnit): string {
  return SPEED[unit].label
}

// ---------------------------------------------------------- vertical speed

/**
 * Climb rate, which does not simply follow the speed choice.
 *
 * Aviation reads vertical speed in feet per minute wherever horizontal
 * distance is in feet, whatever the airspeed unit -- a pilot flying in knots
 * still calls a climb "five hundred feet a minute", never "8 feet a second".
 * So this derives from the distance unit and needs no control of its own,
 * which is also one fewer dropdown to explain.
 */
export function toVerticalSpeed(ms: number, unit: DistanceUnit): number {
  return unit === 'ft' ? (ms / M_PER_FT) * 60 : ms
}

export function verticalSpeedLabel(unit: DistanceUnit): string {
  return unit === 'ft' ? 'ft/min' : 'm/s'
}

// -------------------------------------------------------------- formatting

/**
 * A rounded string for display.
 *
 * The precision follows the unit rather than the number: a foot is a third
 * of a metre and a knot is about two, so the same number of decimals in a
 * bigger unit shows *less* than it did in meters. Feet and knots therefore
 * drop a decimal that meters keep, and nothing here ever shows more
 * precision than the sensor behind it has.
 */
export function formatDistance(meters: number, unit: DistanceUnit, decimals?: number): string {
  const v = toDistance(meters, unit)
  return v.toFixed(decimals ?? (unit === 'ft' ? 0 : Math.abs(v) < 100 ? 1 : 0))
}

export function formatSpeed(ms: number, unit: SpeedUnit, decimals?: number): string {
  const v = toSpeed(ms, unit)
  return v.toFixed(decimals ?? (unit === 'ms' ? 1 : 0))
}

export function formatVerticalSpeed(ms: number, unit: DistanceUnit): string {
  const v = toVerticalSpeed(ms, unit)
  return unit === 'ft' ? v.toFixed(0) : v.toFixed(1)
}

/** Every choice a preferences control offers, with the label it shows. */
export const DISTANCE_CHOICES: { id: DistanceUnit; label: string }[] = [
  { id: 'm', label: 'Meters' },
  { id: 'ft', label: 'Feet' },
]

export const SPEED_CHOICES: { id: SpeedUnit; label: string }[] = [
  { id: 'ms', label: 'Meters per second' },
  { id: 'kmh', label: 'Kilometers per hour' },
  { id: 'kts', label: 'Knots' },
  { id: 'mph', label: 'Miles per hour' },
]
