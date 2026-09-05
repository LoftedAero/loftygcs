// Which airframe is this, beyond "a plane"?
//
// ArduPilot announces its frame at boot -- "QuadPlane Frame: F-35B" -- and
// that line goes to two places: STATUSTEXT over the link, and a MSG record
// in the dataflash log. So the same string identifies a vehicle whether it
// is connected or was flown last week, which is why this lives in protocol
// rather than beside either consumer.
//
// The wording moves between firmware versions and the exact phrase is not
// the interesting part: 4.2.2 writes "QuadPlane Frame: F-35B" and 4.6.3
// writes "QuadPlane initialised, Frame: F-35B". Matching either one exactly
// would have missed every log that already exists, so what is matched is
// the part ArduPilot has kept stable -- "Frame:" and the name after it.

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
 * Airframes we can draw as themselves rather than as a generic vehicle.
 *
 * A short list on purpose. Every entry needs a model whose license lets it
 * ship here, so this grows one aircraft at a time and never by pattern.
 */
export type KnownAirframe = 'f35b'

const MATCHERS: [KnownAirframe, RegExp][] = [
  // Both EDF sizes report the same frame; they are the same aircraft to a
  // renderer, and to the motors class that names them.
  ['f35b', /^F-?35B$/i],
]

/** The airframe a frame name identifies, or null for anything unrecognized. */
export function knownAirframe(frame: string | null | undefined): KnownAirframe | null {
  if (!frame) return null
  for (const [id, re] of MATCHERS) if (re.test(frame)) return id
  return null
}

/** Convenience for the two callers that hold raw announcement lines. */
export function airframeFrom(lines: readonly string[]): KnownAirframe | null {
  return knownAirframe(frameName(lines))
}

/**
 * The airframe a log was flown by.
 *
 * The frame line is written once, at boot, into MSG -- the same record
 * that carries the firmware banner. Nothing else in the log names the
 * airframe, so a log that was already running when recording started has
 * no answer here, and null is the honest one.
 */
export function airframeFromLog(log: ParsedLog): KnownAirframe | null {
  const texts = log.messages.get('MSG')?.columns.get('Message')
  return Array.isArray(texts) ? airframeFrom(texts as unknown as string[]) : null
}
