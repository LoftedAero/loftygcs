// Converting the vehicle's numbers to the reader's units.
//
// Everything inside the app is SI, as MAVLink is. Conversion happens only at
// the edge: on the way to the screen and back from the keyboard. The stored
// value is canonical and the displayed one is always derived, because a units
// bug in a mission altitude is a flying-into-terrain bug.
//
// Dependency-free, like src/sim-home.ts.

export type DistanceUnit = 'm' | 'ft'
export type SpeedUnit = 'ms' | 'kmh' | 'kts' | 'mph'

/**
 * How climb rate reads. `follow` (the default) is the aviation convention:
 * feet per minute whenever distance is in feet, whatever the airspeed unit.
 * The other two override it.
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

/** The reader's distance unit back to meters, the only value we store. */
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
 * Which climb-rate unit is in force. The only place `follow` is resolved, so
 * nothing downstream needs to know the convention.
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
 * A rounded string for display. Precision follows the unit: feet and knots
 * drop the decimal that meters keep, so nothing shows more precision than
 * the sensor has.
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
 * `toFixed` without "-0". A vehicle on the ground often reads a hair under
 * zero, and rounding keeps the sign.
 */
export function fixed(v: number, decimals: number): string {
  const s = v.toFixed(decimals)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s
}

export function formatVerticalSpeed(ms: number, units: UnitPrefs): string {
  const v = toVerticalSpeed(ms, units)
  // Whole feet per minute; tenths of a meter per second.
  return fixed(v, resolveVerticalSpeed(units) === 'fpm' ? 0 : 1)
}

/** Every choice a preferences control offers, with the label it shows. */
export const DISTANCE_CHOICES: { id: DistanceUnit; label: string }[] = [
  { id: 'm', label: 'Meters' },
  { id: 'ft', label: 'Feet' },
]

/** The climb-rate choices, the default `follow` first. */
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
