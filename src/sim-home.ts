// Where a simulated vehicle boots.
//
// Lives at the src root rather than in protocol/ or electron/ because both
// ends need it and neither owns it: the renderer parses what someone typed,
// the Electron main process turns the result into SITL's --home argument.
// No DOM, no Node -- it is arithmetic on a string.

/** Where a simulated vehicle boots: SITL's `--home lat,lon,alt,yaw`. */
export interface SimHome {
  latDeg: number
  lonDeg: number
  /** Meters above mean sea level. Also the EKF origin's altitude. */
  altM: number
  /** Which way the airframe points on the ground, degrees from north. */
  headingDeg: number
}

export const CMAC_HOME: SimHome = {
  latDeg: -35.363262,
  lonDeg: 149.165237,
  altM: 584,
  headingDeg: 270,
}

/**
 * Read a home location typed or pasted by a person.
 *
 * Accepts what a map's "copy coordinates" puts on the clipboard -- two
 * numbers separated by a comma -- and optionally an altitude and a heading
 * after them. Returns the reason it is unusable rather than a boolean,
 * because "it did not take" with no explanation is the worst outcome for a
 * field whose input comes from somewhere else entirely.
 */
export function parseHome(text: string): { home: SimHome } | { error: string } {
  const parts = text
    .replace(/[()]/g, '')
    .split(/[,;\s]+/)
    .filter(Boolean)
  if (parts.length < 2) return { error: 'Give at least a latitude and a longitude.' }
  if (parts.length > 4) return { error: 'Expected latitude, longitude, altitude, heading.' }
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) {
    // Degrees-minutes-seconds is the usual reason a paste lands here, and
    // it is worth naming rather than saying "not a number".
    return { error: 'Use decimal degrees, like 38.9034, -77.0365.' }
  }
  const [latDeg, lonDeg, altM = 0, headingDeg = 0] = nums as [number, number, number?, number?]
  // A latitude past the poles is nearly always a swapped pair -- the one
  // typo in a coordinate that stays plausible-looking all the way to a
  // vehicle booting in the wrong ocean.
  if (Math.abs(latDeg) > 90) {
    return { error: `Latitude ${latDeg} is out of range. Latitude comes first — are they swapped?` }
  }
  if (Math.abs(lonDeg) > 180) return { error: `Longitude ${lonDeg} is out of range.` }
  if (!Number.isFinite(altM) || altM < -500 || altM > 9000) {
    return { error: 'Altitude should be meters above sea level.' }
  }
  return { home: { latDeg, lonDeg, altM, headingDeg } }
}

/** The `--home` argument SITL wants. */
export function formatHome(home: SimHome): string {
  return [home.latDeg, home.lonDeg, home.altM, home.headingDeg].join(',')
}

