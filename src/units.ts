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

/**
 * How climb rate reads.
 *
 * `follow` is the aviation convention and the default: vertical speed is
 * feet per minute wherever horizontal distance is in feet, whatever the
 * airspeed unit -- a pilot flying in knots still calls a climb "five hundred
 * feet a minute", never "8 feet a second". It stayed the only behavior for a
 * while on the grounds that a third dropdown was worse than the convention,
 * and it is still what the app does out of the box; the other two exist
 * because the convention is a default, not a rule, and someone reading
 * altitude in feet off a metric airframe has a reason to break it.
 */
export type VerticalSpeedUnit = 'follow' | 'ms' | 'fpm'

/** What `follow` actually resolves to, and the only thing below reads. */
export type ResolvedVerticalSpeed = Exclude<VerticalSpeedUnit, 'follow'>

export interface UnitPrefs {
  distance: DistanceUnit
  speed: SpeedUnit
  verticalSpeed: VerticalSpeedUnit
}

export const DEFAULT_UNITS: UnitPrefs = { distance: 'm', speed: 'ms', verticalSpeed: 'follow' }

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
 * Which climb-rate unit is actually in force.
 *
 * The one place `follow` is turned into a real unit, so nothing downstream
 * has to know the convention -- everything below takes the resolved unit and
 * the preference is read exactly once, here.
 */
export function resolveVerticalSpeed(units: UnitPrefs): ResolvedVerticalSpeed {
  if (units.verticalSpeed !== 'follow') return units.verticalSpeed
  return units.distance === 'ft' ? 'fpm' : 'ms'
}

export function toVerticalSpeed(ms: number, units: UnitPrefs): number {
  return resolveVerticalSpeed(units) === 'fpm' ? (ms / M_PER_FT) * 60 : ms
}

export function verticalSpeedLabel(units: UnitPrefs): string {
  return resolveVerticalSpeed(units) === 'fpm' ? 'ft/min' : 'm/s'
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
  return fixed(v, decimals ?? (unit === 'ft' ? 0 : Math.abs(v) < 100 ? 1 : 0))
}

export function formatSpeed(ms: number, unit: SpeedUnit, decimals?: number): string {
  const v = toSpeed(ms, unit)
  return fixed(v, decimals ?? (unit === 'ms' ? 1 : 0))
}

/**
 * `toFixed`, without its "-0". A vehicle sitting on the ground reads a hair
 * under zero, and rounding keeps the sign: the HUD's altitude box and the
 * altitude field both said "-0" for a vehicle that had not moved.
 */
export function fixed(v: number, decimals: number): string {
  const s = v.toFixed(decimals)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

export function formatVerticalSpeed(ms: number, units: UnitPrefs): string {
  const v = toVerticalSpeed(ms, units)
  // Feet per minute are whole numbers -- "500", never "500.0" -- and a
  // tenth of a meter per second is the smallest climb worth reading.
  return fixed(v, resolveVerticalSpeed(units) === 'fpm' ? 0 : 1)
}

/** Every choice a preferences control offers, with the label it shows. */
export const DISTANCE_CHOICES: { id: DistanceUnit; label: string }[] = [
  { id: 'm', label: 'Meters' },
  { id: 'ft', label: 'Feet' },
]

/**
 * The climb-rate choices.
 *
 * `follow` leads because it is the default and the convention; its label is
 * filled in with whatever it currently resolves to, so the dropdown says
 * what it is doing rather than making it a thing to work out.
 */
export const VERTICAL_SPEED_CHOICES: { id: VerticalSpeedUnit; label: string }[] = [
  { id: 'follow', label: 'Follow distance' },
  { id: 'ms', label: 'Meters per second' },
  { id: 'fpm', label: 'Feet per minute' },
]

export const SPEED_CHOICES: { id: SpeedUnit; label: string }[] = [
  { id: 'ms', label: 'Meters per second' },
  { id: 'kmh', label: 'Kilometers per hour' },
  { id: 'kts', label: 'Knots' },
  { id: 'mph', label: 'Miles per hour' },
]
