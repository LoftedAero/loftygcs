// The flight path from a log, joined onto one timeline for replay.
//
// Position and attitude are logged in separate, unaligned messages, so
// attitude is interpolated onto each position's timestamp.
//
//   POS  the EKF's position estimate, what the aircraft flew on. Preferred.
//   AHR2 position and attitude together; used when POS is absent.
//   GPS  the raw receiver, used last: it is the EKF's input, and it jumps.
//
// Units are degrees and meters, as the parser scales them.

import { getSeries, type ParsedLog } from './dataflash'

export interface PathSample {
  /** Seconds since boot. */
  time: number
  lat: number
  lon: number
  /** Meters above mean sea level, as the log reports it. */
  alt: number
  /**
   * Meters above the launch point. Use this on a globe with no terrain, where
   * the ground is at ellipsoid height zero and an AMSL track would float.
   */
  altAboveHome: number
  /** Degrees. Zero when the log carried no attitude to sample. */
  roll: number
  pitch: number
  /** Degrees from north. */
  yaw: number
}

export interface FlightPath {
  samples: PathSample[]
  /** Which message the positions came from. */
  source: string | null
  /** AMSL elevation of the launch point, if the log said. */
  groundAlt: number | null
  /** Whether attitude was found, or the samples are flying level. */
  hasAttitude: boolean
  problems: string[]
}

/** Position sources, best first. Each names its own field spellings. */
const POSITION_SOURCES: { message: string; lat: string; lon: string; alt: string }[] = [
  { message: 'POS', lat: 'Lat', lon: 'Lng', alt: 'Alt' },
  { message: 'AHR2', lat: 'Lat', lon: 'Lng', alt: 'Alt' },
  { message: 'GPS', lat: 'Lat', lon: 'Lng', alt: 'Alt' },
]

/** Attitude sources, best first. */
const ATTITUDE_SOURCES = ['ATT', 'AHR2']

export function flightPath(log: ParsedLog): FlightPath {
  const problems: string[] = []

  let source: string | null = null
  let lat: Float64Array | null = null
  let lon: Float64Array | null = null
  let alt: Float64Array | null = null
  let time: Float64Array | null = null

  for (const candidate of POSITION_SOURCES) {
    const latS = getSeries(log, candidate.message, candidate.lat)
    const lonS = getSeries(log, candidate.message, candidate.lon)
    const altS = getSeries(log, candidate.message, candidate.alt)
    if (!latS || !lonS || !altS) continue
    source = candidate.message
    time = latS.time
    lat = latS.values
    lon = lonS.values
    alt = altS.values
    break
  }

  if (!source || !time || !lat || !lon || !alt) {
    return {
      samples: [],
      source: null,
      groundAlt: null,
      hasAttitude: false,
      problems: ['No position in this log.'],
    }
  }

  // Height above the launch point. POS logs it directly; otherwise it is AMSL
  // altitude less the ground's, taken from the EKF origin or else the first
  // fix (the aircraft was on the ground for both).
  const relative = getSeries(log, source, 'RelHomeAlt')?.values ?? null
  const originAlt = getSeries(log, 'ORGN', 'Alt')?.values[0] ?? null
  let groundAlt = originAlt

  let attTime: Float64Array | null = null
  let roll: Float64Array | null = null
  let pitch: Float64Array | null = null
  let yaw: Float64Array | null = null
  for (const message of ATTITUDE_SOURCES) {
    const r = getSeries(log, message, 'Roll')
    const p = getSeries(log, message, 'Pitch')
    const y = getSeries(log, message, 'Yaw')
    if (!r || !p || !y) continue
    attTime = r.time
    roll = r.values
    pitch = p.values
    yaw = y.values
    break
  }
  if (!attTime) problems.push('No attitude in this log; the replay flies level.')

  const samples: PathSample[] = []
  let cursor = 0
  for (let i = 0; i < time.length; i++) {
    const la = lat[i]!
    const lo = lon[i]!
    // Before the EKF has an origin these are exactly zero, a real place in
    // the Atlantic.
    if (la === 0 && lo === 0) continue
    const t = time[i]!
    let r = 0
    let p = 0
    let y = 0
    if (attTime && roll && pitch && yaw) {
      cursor = advance(attTime, t, cursor)
      r = interpolate(attTime, roll, t, cursor)
      p = interpolate(attTime, pitch, t, cursor)
      y = interpolateAngle(attTime, yaw, t, cursor)
    }
    const amsl = alt[i]!
    if (groundAlt === null) groundAlt = amsl
    samples.push({
      time: t,
      lat: la,
      lon: lo,
      alt: amsl,
      altAboveHome: relative ? relative[i]! : amsl - groundAlt,
      roll: r,
      pitch: p,
      yaw: y,
    })
  }

  if (samples.length === 0) problems.push('The log has position records but no fix in any of them.')
  return { samples, source, groundAlt, hasAttitude: attTime !== null, problems }
}

/**
 * Walk a cursor forward to the last sample at or before `t`. Both streams are
 * in time order, so the join is a merge rather than a search per sample.
 */
function advance(times: Float64Array, t: number, from: number): number {
  let i = from
  while (i + 1 < times.length && times[i + 1]! <= t) i++
  return i
}

function interpolate(times: Float64Array, values: Float64Array, t: number, i: number): number {
  const t0 = times[i]!
  const v0 = values[i]!
  if (i + 1 >= times.length) return v0
  const t1 = times[i + 1]!
  if (t1 <= t0) return v0
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  return v0 + (values[i + 1]! - v0) * f
}

/**
 * Interpolate a heading the short way round: yaw wraps at 360, and a plain
 * average of 359 and 1 gives 180.
 */
function interpolateAngle(times: Float64Array, values: Float64Array, t: number, i: number): number {
  const t0 = times[i]!
  const v0 = values[i]!
  if (i + 1 >= times.length) return v0
  const t1 = times[i + 1]!
  if (t1 <= t0) return v0
  const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  const delta = ((values[i + 1]! - v0 + 540) % 360) - 180
  const out = v0 + delta * f
  return ((out % 360) + 360) % 360
}

/** Where the aircraft was at a moment, for scrubbing. */
export function sampleAt(path: FlightPath, t: number): PathSample | null {
  const { samples } = path
  if (samples.length === 0) return null
  if (t <= samples[0]!.time) return samples[0]!
  if (t >= samples[samples.length - 1]!.time) return samples[samples.length - 1]!
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid]!.time <= t) lo = mid
    else hi = mid
  }
  return samples[lo]!
}
