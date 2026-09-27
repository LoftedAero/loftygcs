// Where a simulated vehicle boots.
//
// At the src root because both the renderer and the Electron main process
// use it. No DOM or Node dependencies.

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
 * Where RealFlight's default scenery, Eli Field (a real strip in Monticello,
 * Illinois), sits on Earth.
 *
 * RealFlight's content carries no latitude or longitude, so these numbers
 * were aligned by eye against imagery. A starting point, not a survey: it is
 * only the FlightAxis default, and any pick on the map replaces it.
 */
export const ELI_FIELD: SimHome = {
  latDeg: 40.059422,
  lonDeg: -88.551405,
  altM: 206,
  headingDeg: 43,
}

/**
 * Where a simulator boots when nobody has chosen.
 *
 * Follows the physics: SITL's own model opens at CMAC, RealFlight's default
 * scenery is Eli Field. Takes the kind as a string so this file does not
 * depend on the renderer's types.
 */
export function defaultHome(physicsKind: string): SimHome {
  return physicsKind === 'flightaxis' ? ELI_FIELD : CMAC_HOME
}

/**
 * Read a home location typed or pasted by a person.
 *
 * Accepts what a map's "copy coordinates" produces (two comma-separated
 * numbers), optionally followed by altitude and heading. Returns the reason
 * when the input is unusable.
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
    // Usually a degrees-minutes-seconds paste.
    return { error: 'Use decimal degrees, like 38.9034, -77.0365.' }
  }
  const [latDeg, lonDeg, altM = 0, headingDeg = 0] = nums as [number, number, number?, number?]
  // A latitude past the poles is nearly always a swapped pair.
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
