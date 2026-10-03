// Turning the vehicle's words into words a speech engine says well.
//
// Applied to the text as written, before anything changes its case:
// QGroundControl lowercases first, which keeps its own acronym list from
// ever matching.

import { formatDistance, formatSpeed, type UnitPrefs } from '../../units'

/** ArduPilot's mode names where the written form reads badly aloud. */
const MODE_WORDS: Record<string, string> = {
  AltHold: 'Altitude hold',
  PosHold: 'Position hold',
  RTL: 'Return to launch',
  Smart_RTL: 'Smart return to launch',
  'Auto RTL': 'Auto return to launch',
  FBWA: 'Fly by wire A',
  FBWB: 'Fly by wire B',
  QStabilize: 'Q stabilize',
  QHover: 'Q hover',
  QLoiter: 'Q loiter',
  QLand: 'Q land',
  QRTL: 'Q return to launch',
  QAutotune: 'Q autotune',
  QAcro: 'Q acro',
  'Loiter to QLand': 'Loiter to Q land',
  Avoid_ADSB: 'Avoid A D S B',
  Guided_NoGPS: 'Guided no G P S',
  SystemID: 'System I D',
  Heli_Autorotate: 'Autorotate',
  AutoTune: 'Autotune',
  ZigZag: 'Zig zag',
  FlowHold: 'Flow hold',
}

export function modeWords(name: string): string {
  return MODE_WORDS[name] ?? name.replace(/_/g, ' ')
}

/**
 * Abbreviations, matched case-sensitively as whole words. Spelled-out
 * letters are written with spaces, which every engine reads as letters.
 */
const WORDS: [RegExp, string][] = [
  [/\bPreArm\b/g, 'Pre-arm'],
  [/\bEKF\d?\b/g, 'E K F'],
  [/\bAHRS\b/g, 'A H R S'],
  [/\bGPS\d?\b/g, 'G P S'],
  [/\bGNSS\b/g, 'G N S S'],
  [/\bIMU\d?\b/g, 'I M U'],
  [/\bRTL\b/g, 'return to launch'],
  [/\bRC\b/g, 'R C'],
  [/\bESC\b/g, 'E S C'],
  [/\bADS-?B\b/g, 'A D S B'],
  [/\bVTOL\b/g, 'V tol'],
  [/\bFBWA\b/g, 'fly by wire A'],
  [/\bFBWB\b/g, 'fly by wire B'],
  [/\bHDOP\b/g, 'H dop'],
  [/\bWP\b/g, 'waypoint'],
  [/\bAlt\b/g, 'altitude'],
  [/\bBatt\b/g, 'battery'],
  [/\bFS\b/g, 'failsafe'],
]

/** Numbers with units glued on ("10m", "3.5V") get the unit as a word. */
const UNITS: [RegExp, string][] = [
  [/(\d)\s?m\/s\b/g, '$1 meters per second'],
  [/(\d)\s?mAh\b/g, '$1 milliamp hours'],
  [/(\d)\s?ms\b/g, '$1 milliseconds'],
  [/(\d)\s?km\b/g, '$1 kilometers'],
  [/(\d)\s?m\b/g, '$1 meters'],
  [/(\d)\s?V\b/g, '$1 volts'],
  [/(\d)\s?A\b/g, '$1 amps'],
  [/(\d)\s?%/g, '$1 percent'],
  [/(\d)\s?deg\b/g, '$1 degrees'],
]

export function forSpeech(text: string): string {
  let s = text.replace(/^#\s*/, '').trim()
  for (const [re, w] of WORDS) s = s.replace(re, w)
  for (const [re, w] of UNITS) s = s.replace(re, w)
  // Underscores and runs of punctuation read as noise.
  s = s.replace(/_/g, ' ').replace(/\s*[-:]\s+/g, ', ')
  return s.replace(/\s+/g, ' ').trim()
}

const DIST_WORD = { m: 'meters', ft: 'feet' } as const

/** A distance as said aloud: rounded to what an ear can use. */
export function distanceWords(m: number, units: UnitPrefs): string {
  const big = (v: number, word: string) => {
    const s = v.toFixed(1).replace(/\.0$/, '')
    return `${s} ${word}${s === '1' ? '' : 's'}`
  }
  if (units.distance === 'ft') {
    const ft = m * 3.28084
    if (ft >= 5280) return big(ft / 5280, 'mile')
    return `${Math.round(ft / (ft >= 1000 ? 100 : 10)) * (ft >= 1000 ? 100 : 10)} feet`
  }
  if (m >= 1000) return big(m / 1000, 'kilometer')
  return `${Math.round(m / (m >= 100 ? 10 : 1)) * (m >= 100 ? 10 : 1)} ${DIST_WORD.m}`
}

/** A height, to the nearest unit: altitudes are read more precisely than ranges. */
export function heightWords(m: number, units: UnitPrefs): string {
  return `${formatDistance(m, units.distance, 0)} ${DIST_WORD[units.distance]}`
}

const SPEED_WORD = {
  ms: 'meters per second',
  kmh: 'kilometers an hour',
  kts: 'knots',
  mph: 'miles an hour',
} as const

export function speedWords(ms: number, units: UnitPrefs): string {
  return `${formatSpeed(ms, units.speed, 0)} ${SPEED_WORD[units.speed]}`
}

/** A bearing relative to the nose, as a clock position. */
export function clockWords(relativeDeg: number): string {
  const hour = Math.round((((relativeDeg % 360) + 360) % 360) / 30) % 12
  return `${hour === 0 ? 12 : hour} o'clock`
}
