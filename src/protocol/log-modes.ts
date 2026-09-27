// Which flight mode the aircraft was in, and when.
//
// A log records mode changes, not mode state, so MODE records are turned into
// spans for shading plot backgrounds. Mode numbers are per vehicle (Auto is 3
// on Copter and 10 on Plane); the vehicle comes from the log's firmware string.

import type { ParsedLog } from './dataflash'
import { modeName, type VehicleClass } from './modes'

/** A stretch of time in one flight mode. */
export interface ModeSpan {
  /** Seconds since boot. */
  from: number
  to: number
  mode: number
  name: string
}

/** A representative MAV_TYPE per family, for the mode tables. */
const TYPE_FOR_CLASS: Record<VehicleClass, number> = {
  copter: 2, // MAV_TYPE_QUADROTOR
  plane: 1, // MAV_TYPE_FIXED_WING
  rover: 10, // MAV_TYPE_GROUND_ROVER
  other: 0,
}

/**
 * What kind of vehicle wrote this log, from the firmware string. Parameters
 * are ambiguous: FRAME_CLASS exists on a plane too.
 */
export function vehicleClassFromLog(log: ParsedLog): VehicleClass {
  const banner = firmwareString(log)
  if (!banner) return 'other'
  if (/copter|heli/i.test(banner)) return 'copter'
  if (/plane/i.test(banner)) return 'plane'
  if (/rover|boat/i.test(banner)) return 'rover'
  return 'other'
}

/** The firmware banner, e.g. "ArduCopter V4.7.1-beta1". */
export function firmwareString(log: ParsedLog): string | null {
  const ver = log.messages.get('VER')
  const fws = ver?.columns.get('FWS')
  if (Array.isArray(fws) && fws.length > 0 && fws[0]) return fws[0]
  // Older logs announce themselves in the first MSG instead.
  const msg = log.messages.get('MSG')
  const texts = msg?.columns.get('Message')
  if (Array.isArray(texts)) {
    const hit = texts.find((t) => /^Ardu|^APM:|Copter|Plane|Rover/i.test(t))
    if (hit) return hit
  }
  return null
}

/**
 * Flight-mode spans across the log. The last span runs to the end of the log,
 * since the vehicle stayed in that mode until recording stopped.
 */
export function modeSpans(log: ParsedLog): ModeSpan[] {
  const table = log.messages.get('MODE')
  if (!table) return []
  const time = table.columns.get('TimeUS')
  const mode = table.columns.get('Mode') ?? table.columns.get('ModeNum')
  if (!(time instanceof Float64Array) || !(mode instanceof Float64Array)) return []

  const mavType = TYPE_FOR_CLASS[vehicleClassFromLog(log)]
  const end = logEnd(log)
  const spans: ModeSpan[] = []
  for (let i = 0; i < time.length; i++) {
    const from = time[i]!
    const to = i + 1 < time.length ? time[i + 1]! : Math.max(end, from)
    const num = mode[i]!
    // ArduPilot sometimes re-records the current mode (a failsafe clearing,
    // say); merge repeats into one span.
    const prev = spans[spans.length - 1]
    if (prev && prev.mode === num) {
      prev.to = to
      continue
    }
    spans.push({ from, to, mode: num, name: modeName(mavType, num) })
  }
  return spans
}

/** The last timestamp anywhere in the log, in seconds. */
export function logEnd(log: ParsedLog): number {
  let end = 0
  for (const table of log.messages.values()) {
    const time = table.columns.get('TimeUS')
    if (time instanceof Float64Array && time.length > 0) {
      const last = time[time.length - 1]!
      if (last > end) end = last
    }
  }
  return end
}
