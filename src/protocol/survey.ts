// Survey grids: covering a polygon with a lawnmower path.
//
// The geometry is done in local meters, not degrees. A degree of longitude is
// 111 km at the equator and 55 km at 60 degrees of latitude, so a grid
// computed in raw lat/lon comes out sheared. Projecting to meters about the
// polygon's center keeps the spacing true over the few kilometers a survey
// spans.

/** Degrees * 1e7, as mission items carry them. */
export interface GeoPoint {
  x: number
  y: number
}

/** Meters east and north of the projection origin. */
interface LocalPoint {
  e: number
  n: number
}

const EARTH_R = 6378137

export interface SurveyOptions {
  /** Distance between adjacent passes, meters. */
  spacingM: number
  /** Direction of the passes, degrees clockwise from north. */
  angleDeg: number
  /**
   * How far each pass runs past the polygon edge, meters, so the aircraft is
   * level before the boundary and has room to turn.
   */
  overshootM: number
}

export const SURVEY_DEFAULTS: SurveyOptions = { spacingM: 40, angleDeg: 0, overshootM: 10 }

/** Mean of the vertices; good enough as a projection origin for a survey. */
function centroid(poly: readonly GeoPoint[]): GeoPoint {
  const x = poly.reduce((a, p) => a + p.x, 0) / poly.length
  const y = poly.reduce((a, p) => a + p.y, 0) / poly.length
  return { x, y }
}

function toLocal(p: GeoPoint, origin: GeoPoint): LocalPoint {
  const latRad = (origin.x / 1e7) * (Math.PI / 180)
  const dLat = (p.x - origin.x) / 1e7
  const dLon = (p.y - origin.y) / 1e7
  return {
    e: dLon * (Math.PI / 180) * EARTH_R * Math.cos(latRad),
    n: dLat * (Math.PI / 180) * EARTH_R,
  }
}

function toGeo(p: LocalPoint, origin: GeoPoint): GeoPoint {
  const latRad = (origin.x / 1e7) * (Math.PI / 180)
  const dLat = (p.n / EARTH_R) * (180 / Math.PI)
  const dLon = (p.e / (EARTH_R * Math.cos(latRad))) * (180 / Math.PI)
  return { x: Math.round(origin.x + dLat * 1e7), y: Math.round(origin.y + dLon * 1e7) }
}

/** Signed area in local meters; the sign is the winding order. */
function signedArea(poly: readonly LocalPoint[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    a += p.e * q.n - q.e * p.n
  }
  return a / 2
}

/** Area of the polygon in square meters, whichever way it is wound. */
export function polygonAreaM2(poly: readonly GeoPoint[]): number {
  if (poly.length < 3) return 0
  const origin = centroid(poly)
  return Math.abs(signedArea(poly.map((p) => toLocal(p, origin))))
}

/**
 * Where a horizontal line at `y` crosses the polygon's edges.
 *
 * The half-open test (lower endpoint inclusive, upper exclusive) counts a
 * vertex lying exactly on the line once, not twice or never.
 */
function crossingsAt(poly: readonly LocalPoint[], y: number): number[] {
  const xs: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const lo = Math.min(a.n, b.n)
    const hi = Math.max(a.n, b.n)
    if (y < lo || y >= hi) continue
    const t = (y - a.n) / (b.n - a.n)
    xs.push(a.e + t * (b.e - a.e))
  }
  return xs.sort((p, q) => p - q)
}

export interface SurveyResult {
  /** The path, in flight order. Empty when the polygon cannot be surveyed. */
  points: GeoPoint[]
  /** Number of passes across the area. */
  passes: number
  /** Total ground distance of the path, meters. */
  lengthM: number
  /** Why there is no path, when there is none. */
  problem?: string
}

/** Upper bound on passes; see the check in surveyGrid. */
export const MAX_PASSES = 400

/**
 * Cover a polygon with parallel passes, joined end to end.
 *
 * The polygon is rotated so the passes lie horizontal, scanned with
 * horizontal lines, and rotated back.
 */
export function surveyGrid(polygon: readonly GeoPoint[], opts: SurveyOptions): SurveyResult {
  const empty = (problem: string): SurveyResult => ({ points: [], passes: 0, lengthM: 0, problem })
  if (polygon.length < 3) return empty('A survey area needs at least three corners.')
  if (!(opts.spacingM > 0)) return empty('Line spacing must be greater than zero.')

  const origin = centroid(polygon)
  const local = polygon.map((p) => toLocal(p, origin))
  if (Math.abs(signedArea(local)) < 1) return empty('That area is too small to survey.')

  const a = (-opts.angleDeg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const turned = local.map((p) => ({ e: p.e * cos - p.n * sin, n: p.e * sin + p.n * cos }))
  const unrot = (p: LocalPoint): LocalPoint => ({
    e: p.e * cos + p.n * sin,
    n: -p.e * sin + p.n * cos,
  })

  const minN = Math.min(...turned.map((p) => p.n))
  const maxN = Math.max(...turned.map((p) => p.n))

  // Check before computing: a wide area at a fine spacing runs to tens of
  // thousands of waypoints, more than ArduPilot's mission storage holds.
  const wanted = Math.floor((maxN - minN) / opts.spacingM) + 1
  if (wanted > MAX_PASSES) {
    return empty(
      `That would take ${wanted.toLocaleString()} passes. Widen the spacing or ` +
        'draw a smaller area.',
    )
  }

  const rows: number[] = []
  // Half a spacing in from the edge, so no swath is half outside the area.
  const first = minN + opts.spacingM / 2
  if (first > maxN) {
    // Narrower than one spacing: one pass down the middle.
    rows.push(minN + (maxN - minN) / 2)
  } else {
    for (let y = first; y <= maxN; y += opts.spacingM) rows.push(y)
  }

  const points: GeoPoint[] = []
  let passes = 0
  let flip = false

  for (const y of rows) {
    const xs = crossingsAt(turned, y)
    // Crossings pair into spans inside the polygon. A concave area can give
    // several spans on one line, each flown as its own pass.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const lo = xs[i]! - opts.overshootM
      const hi = xs[i + 1]! + opts.overshootM
      if (hi <= lo) continue
      // Alternate direction so consecutive passes join end to end.
      const ends: LocalPoint[] = flip
        ? [
            { e: hi, n: y },
            { e: lo, n: y },
          ]
        : [
            { e: lo, n: y },
            { e: hi, n: y },
          ]
      flip = !flip
      passes++
      for (const p of ends) points.push(toGeo(unrot(p), origin))
    }
  }

  if (points.length === 0) {
    return empty('No passes fit inside that area.')
  }
  return { points, passes, lengthM: pathLengthM(points) }
}

/** Ground distance along a path, meters. */
export function pathLengthM(points: readonly GeoPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const l = toLocal(points[i]!, points[i - 1]!)
    total += Math.hypot(l.e, l.n)
  }
  return total
}
