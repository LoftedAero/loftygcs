import type { FieldValue } from './types'

// Other aircraft, as the vehicle's ADS-B receiver reports them. Display only:
// ArduPilot does its own avoidance from the same data (AVD_* parameters).
//
// ADSB_VEHICLE carries every field whatever the receiver actually knows, so an
// aircraft with no position still arrives with a (stale or noisy) lat and lon.
// Every optional field is therefore null unless its flag is set, and a report
// without a valid position is not a target.
//
// Units differ within the message: altitude in millimeters, heading in
// centidegrees, velocities in cm/s. Everything leaves here in SI.

/** ADSB_FLAGS, the bits that say which fields to believe. */
const VALID_COORDS = 1
const VALID_ALTITUDE = 2
const VALID_HEADING = 4
const VALID_VELOCITY = 8
const VALID_CALLSIGN = 16
const VALID_SQUAWK = 32
const SIMULATED = 64
const VERTICAL_VELOCITY_VALID = 128

/** ADSB_EMITTER_TYPE labels for the types worth telling apart on a map. */
export const EMITTER_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'Light',
  2: 'Small',
  3: 'Large',
  4: 'High vortex',
  5: 'Heavy',
  6: 'Highly manoeuvrable',
  7: 'Rotorcraft',
  9: 'Glider',
  10: 'Lighter-than-air',
  11: 'Parachute',
  12: 'Ultralight',
  14: 'UAV',
  15: 'Space',
  17: 'Emergency surface',
  18: 'Service surface',
  19: 'Point obstacle',
}

/** Emitters that are not flying, and should not be drawn as if they were. */
const GROUND_EMITTERS = new Set([17, 18, 19])

export interface AdsbTarget {
  /** ICAO 24-bit address, the identity key. Callsigns are optional and not unique. */
  icao: number
  latDeg: number
  lonDeg: number
  /** AMSL meters, or null when the report did not vouch for an altitude. */
  altMslM: number | null
  /** True degrees, or null. */
  headingDeg: number | null
  /** Ground speed, m/s, or null. */
  groundSpeedMs: number | null
  /** Climb rate, m/s, positive up, or null. */
  climbMs: number | null
  callsign: string | null
  emitterType: number
  squawk: number | null
  /** Seconds since the vehicle's receiver last heard this aircraft. */
  sinceHeardS: number
  /** The vehicle's simulator generated this one (SIM_ADSB_COUNT). */
  simulated: boolean
  /** True for something that is not flying, such as a tower or a ground vehicle. */
  onSurface: boolean
  /** When this station received the report. */
  at: number
}

/**
 * Decodes one ADSB_VEHICLE, or returns null when it has no valid position
 * (everything done with a target needs one).
 */
export function decodeAdsbVehicle(
  fields: Record<string, FieldValue>,
  at: number = Date.now(),
): AdsbTarget | null {
  const flags = Number(fields.flags ?? 0)
  if ((flags & VALID_COORDS) === 0) return null

  const emitterType = Number(fields.emitterType ?? 0)
  return {
    // Not camelCase like the other keys. A wrong key reads as undefined and
    // every target collapses onto one identity.
    icao: Number(fields.ICAOAddress ?? 0),
    latDeg: Number(fields.lat ?? 0) / 1e7,
    lonDeg: Number(fields.lon ?? 0) / 1e7,
    // Millimeters, unlike the velocities (cm/s).
    altMslM: flags & VALID_ALTITUDE ? Number(fields.altitude ?? 0) / 1000 : null,
    headingDeg: flags & VALID_HEADING ? Number(fields.heading ?? 0) / 100 : null,
    groundSpeedMs: flags & VALID_VELOCITY ? Number(fields.horVelocity ?? 0) / 100 : null,
    // Vertical velocity has its own flag, separate from VALID_VELOCITY.
    climbMs: flags & VERTICAL_VELOCITY_VALID ? Number(fields.verVelocity ?? 0) / 100 : null,
    // Often present but blank; an empty callsign becomes null.
    callsign: flags & VALID_CALLSIGN ? cleanCallsign(fields.callsign) : null,
    emitterType,
    squawk: flags & VALID_SQUAWK ? Number(fields.squawk ?? 0) : null,
    sinceHeardS: Number(fields.tslc ?? 0),
    simulated: (flags & SIMULATED) !== 0,
    onSurface: GROUND_EMITTERS.has(emitterType),
    at,
  }
}

function cleanCallsign(raw: FieldValue | undefined): string | null {
  if (typeof raw !== 'string') return null
  // Fixed width, padded with NULs or spaces depending on the transponder.
  const text = raw.replace(/\0/g, '').trim()
  return text.length > 0 ? text : null
}

/**
 * An aircraft's display name: its callsign, or its ICAO address. The squawk
 * is not used because it is shared and reassigned (1200 is every VFR aircraft).
 */
export function targetLabel(t: AdsbTarget): string {
  if (t.callsign) return t.callsign
  // ICAO addresses are conventionally six uppercase hex digits.
  return t.icao.toString(16).toUpperCase().padStart(6, '0')
}

/**
 * Meters between two positions, on a sphere. At ADS-B ranges the earth's
 * flattening is well below the report's own precision.
 */
export function distanceM(
  a: { latDeg: number; lonDeg: number },
  b: { latDeg: number; lonDeg: number },
): number {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (b.latDeg - a.latDeg) * toRad
  const dLon = (b.lonDeg - a.lonDeg) * toRad
  const lat1 = a.latDeg * toRad
  const lat2 = b.latDeg * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Bearing from a to b, degrees true. */
export function bearingDeg(
  a: { latDeg: number; lonDeg: number },
  b: { latDeg: number; lonDeg: number },
): number {
  const toRad = Math.PI / 180
  const lat1 = a.latDeg * toRad
  const lat2 = b.latDeg * toRad
  const dLon = (b.lonDeg - a.lonDeg) * toRad
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) / toRad + 360) % 360
}
