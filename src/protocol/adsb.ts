import type { FieldValue } from './types'

// Other aircraft, as this one's transponder receiver hears them.
//
// ADSB_VEHICLE is a snapshot per aircraft per report, and the vehicle
// forwards whatever its receiver is tracking. Nothing here decides anything:
// ArduPilot does its own avoidance from the same data (the AVD_* parameters),
// and this is the picture of the sky beside the map, not a system that acts.
//
// The one thing that must not be got wrong is that **the flags say which
// fields are real**. A transponder report carries all fourteen fields
// whatever it actually knows, so an aircraft with no position still arrives
// with a lat and a lon, and they are not zero -- they are stale, or noise. A
// reader that trusts them draws an aeroplane somewhere it is not, which on a
// traffic display is worse than drawing nothing. So every optional field
// here is `null` unless its own flag is set, and a report with no valid
// position is not a target at all.
//
// Units are the other trap, and they are all different: altitude in
// millimeters, heading in centidegrees, both velocities in centimeters per
// second. Everything below leaves in SI, like the rest of this app.

/** ADSB_FLAGS, the bits that say which fields to believe. */
const VALID_COORDS = 1
const VALID_ALTITUDE = 2
const VALID_HEADING = 4
const VALID_VELOCITY = 8
const VALID_CALLSIGN = 16
const VALID_SQUAWK = 32
const SIMULATED = 64
const VERTICAL_VELOCITY_VALID = 128

/**
 * ADSB_EMITTER_TYPE. Only the ones worth telling apart on a map are named;
 * everything else is an aircraft, which is what matters when it is near you.
 */
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
  /**
   * The ICAO 24-bit address, and the identity this is keyed on. Not the
   * callsign: that is optional, often blank, and two aircraft can carry the
   * same one where no two share an address.
   */
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
  /** True for a tower, a vehicle on the apron -- something that is not flying. */
  onSurface: boolean
  /** When this station received the report. */
  at: number
}

/**
 * One ADSB_VEHICLE, or null if there is nothing to place on a map.
 *
 * A report without VALID_COORDS is dropped rather than kept without a
 * position: everything this display does with a target -- draw it, measure a
 * distance, sort by how close it is -- needs one, and a list entry that can
 * only ever say "somewhere" is not worth the phantom it risks.
 */
export function decodeAdsbVehicle(
  fields: Record<string, FieldValue>,
  at: number = Date.now(),
): AdsbTarget | null {
  const flags = Number(fields.flags ?? 0)
  if ((flags & VALID_COORDS) === 0) return null

  const emitterType = Number(fields.emitterType ?? 0)
  return {
    // The decoder's own key, and it is not the camelCase every other field
    // uses: `ICAOAddress`. A wrong key here reads as undefined and every
    // target collapses onto one identity.
    icao: Number(fields.ICAOAddress ?? 0),
    latDeg: Number(fields.lat ?? 0) / 1e7,
    lonDeg: Number(fields.lon ?? 0) / 1e7,
    // Millimeters. Not centimeters, which is what the two velocities use in
    // the same message.
    altMslM: flags & VALID_ALTITUDE ? Number(fields.altitude ?? 0) / 1000 : null,
    headingDeg: flags & VALID_HEADING ? Number(fields.heading ?? 0) / 100 : null,
    groundSpeedMs: flags & VALID_VELOCITY ? Number(fields.horVelocity ?? 0) / 100 : null,
    // Vertical velocity has its own flag, separate from VALID_VELOCITY: a
    // receiver can know an aircraft's ground track without its climb rate.
    climbMs: flags & VERTICAL_VELOCITY_VALID ? Number(fields.verVelocity ?? 0) / 100 : null,
    // Nine bytes, NUL padded, and blank-but-present on plenty of aircraft --
    // so an empty one is null rather than an empty string a UI would print
    // as a gap where a name should be.
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
  // NULs, then whitespace: the field is fixed width and padded with both,
  // depending on who built the transponder.
  const text = raw.replace(/\0/g, '').trim()
  return text.length > 0 ? text : null
}

/**
 * What a screen calls an aircraft: its callsign, or its ICAO address.
 *
 * Two levels, not three. The squawk sat between them for a while and does
 * not belong: it is assigned for a flight and reassigned freely, so the same
 * four digits mean different aircraft on different days and 1200 means
 * "nobody assigned me one" on a great many at once -- a label that can be
 * shared by every VFR aircraft in the circuit is not identifying anything.
 * The address always exists and always means this airframe.
 */
export function targetLabel(t: AdsbTarget): string {
  if (t.callsign) return t.callsign
  // Hex, uppercase, six digits: how an ICAO address is written everywhere
  // it is written at all.
  return t.icao.toString(16).toUpperCase().padStart(6, '0')
}

/**
 * Meters between two positions, on a sphere.
 *
 * Traffic is tens of kilometers away at most -- ADS-B reception from a small
 * aircraft is line of sight -- so the earth's flattening is far below the
 * precision of the report itself, and the haversine's simplicity wins.
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
