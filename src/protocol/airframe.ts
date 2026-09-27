// Identifies the airframe from ArduPilot's boot announcement
// ("QuadPlane Frame: F-35B"), which goes to both STATUSTEXT and a dataflash
// MSG record, so one matcher serves the live link and log replay.
//
// The wording varies between firmware versions:
//
//   4.0.6        "QuadPlane initialised"                  (no frame at all)
//   4.1.6beta1   "QuadPlane Frame: F-35B/"                (class, empty type)
//   4.2.2        "QuadPlane Frame: F-35B"
//   4.6.3        "QuadPlane initialised, Frame: F-35B"
//
// Only the stable part is matched: "Frame:" and the class of the name after
// it. 4.0.6 does not say, so it gets null.

import type { ParsedLog } from './dataflash'

/** The frame name ArduPilot reported, e.g. "F-35B", "QUAD/PLUS". */
export function frameName(lines: readonly string[]): string | null {
  for (const line of lines) {
    const m = /\bFrame:\s*([^\s,;]+)/i.exec(line)
    if (m) return m[1]!
  }
  return null
}

/**
 * Airframes drawn as themselves rather than as a generic vehicle. Each entry
 * needs a model whose license lets it ship here, so entries are added one
 * aircraft at a time, never by pattern.
 */
export type KnownAirframe = 'f35b'

const MATCHERS: [KnownAirframe, RegExp][] = [
  // Both EDF sizes report the same frame.
  ['f35b', /^F-?35B$/i],
]

/**
 * The airframe a frame name identifies, or null for anything unrecognized.
 *
 * ArduPilot reports the frame as `class/type` and only the class is matched:
 * a quadplane with no type set logs a trailing slash ("F-35B/"), and Copter
 * reports e.g. "QUAD/PLUS".
 */
export function knownAirframe(frame: string | null | undefined): KnownAirframe | null {
  if (!frame) return null
  const frameClass = frame.split('/')[0]!
  for (const [id, re] of MATCHERS) if (re.test(frameClass)) return id
  return null
}

/** Convenience for the two callers that hold raw announcement lines. */
export function airframeFrom(lines: readonly string[]): KnownAirframe | null {
  return knownAirframe(frameName(lines))
}

/**
 * The airframe a log was flown by. The frame line is written to MSG once at
 * boot, so a log that started recording later returns null.
 */
export function airframeFromLog(log: ParsedLog): KnownAirframe | null {
  const texts = log.messages.get('MSG')?.columns.get('Message')
  return Array.isArray(texts) ? airframeFrom(texts as unknown as string[]) : null
}
