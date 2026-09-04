// Survey grids: covering a polygon with a lawnmower path.
//
// The geometry is done in local metres, not degrees. A degree of longitude is
// 111 km at the equator and 55 km at 60 degrees of latitude, so a grid
// computed in raw lat/lon comes out sheared -- the passes are not parallel and
// the spacing is not the spacing that was asked for. Projecting to metres
// about the polygon's own centre, solving there and projecting back keeps the
// spacing true over the few kilometres a survey actually spans.
//
// Kept apart from the map component because "does this path cover the
// polygon" has a right answer, and one far easier to ask of a function than
// of a picture.

/** Degrees * 1e7, as mission items carry them. */
export interface GeoPoint {
  x: number
  y: number
}

/** Metres east and north of the projection origin. */
interface LocalPoint {
  e: number
  n: number
}

const EARTH_R = 6378137

export interface SurveyOptions {
  /** Distance between adjacent passes, metres. */
  spacingM: number
  /** Direction of the passes, degrees clockwise from north. */
  angleDeg: number
  /**
   * How far each pass runs past the polygon edge, metres. A camera wants the
   * aircraft settled and level before the boundary, and a multirotor wants
   * room to turn round; both are answered by flying past it.
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

/** Signed area in local metres; the sign is the winding order. */
function signedArea(poly: readonly LocalPoint[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!
    const q = poly[(i + 1) % poly.length]!
    a += p.e * q.n - q.e * p.n
  }
  return a / 2
}

/** Area of the polygon in square metres, whichever way it is wound. */
export function polygonAreaM2(poly: readonly GeoPoint[]): number {
  if (poly.length < 3) return 0
  const origin = centroid(poly)
  return Math.abs(signedArea(poly.map((p) => toLocal(p, origin))))
}

/**
 * Where a horizontal line at `y` crosses the polygon's edges.
 *
 * Vertices sitting exactly on the line are the awkward case: counted twice
 * they produce a zero-length pass, counted not at all they open a gap in the
 * coverage. The half-open test here -- lower endpoint inclusive, upper
 * exclusive -- counts each crossing once, which is the standard fix.
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
  /** Total ground distance of the path, metres. */
  lengthM: number
  /** Why there is no path, when there is none. */
  problem?: string
}

/**
 * Cover a polygon with parallel passes, joined end to end.
 *
 * The angle is rotated out rather than solved for: the polygon is turned so
 * the passes lie horizontal, scanned with horizontal lines, and turned back.
 * That keeps the scan a one-dimensional problem, which is where the
 * correctness lives.
 */
/** More passes than this is not a survey anyone flies -- see the check below. */
export const MAX_PASSES = 400

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

  // Refuse an area that would take more passes than anyone can fly before
  // computing them. This is a correctness guard as much as a speed one: a
  // wide area at a fine spacing runs to tens of thousands of waypoints, more
  // than ArduPilot's mission storage holds, and the honest answer is a
  // number to change rather than a locked-up window while it is generated.
  const wanted = Math.floor((maxN - minN) / opts.spacingM) + 1
  if (wanted > MAX_PASSES) {
    return empty(
      `That would take ${wanted.toLocaleString()} passes. Widen the spacing or ` +
        'draw a smaller area.',
    )
  }

  const rows: number[] = []
  // Half a spacing in from the edge: a pass laid exactly on the boundary
  // spends half its swath outside the area, and the far edge then falls to
  // the last pass rather than being missed by it.
  const first = minN + opts.spacingM / 2
  if (first > maxN) {
    // Narrower than one spacing. One pass down the middle still covers it,
    // and covering it is what drawing the area asked for.
    rows.push(minN + (maxN - minN) / 2)
  } else {
    for (let y = first; y <= maxN; y += opts.spacingM) rows.push(y)
  }

  const points: GeoPoint[] = []
  let passes = 0
  let flip = false

  for (const y of rows) {
    const xs = crossingsAt(turned, y)
    // Crossings pair into spans that lie inside the polygon. A concave area
    // gives more than one span on a line, and each is its own pass: flying
    // straight between them would cut across ground that is not in the
    // survey at all.
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const lo = xs[i]! - opts.overshootM
      const hi = xs[i + 1]! + opts.overshootM
      if (hi <= lo) continue
      // Alternate direction, so consecutive passes join end to end instead
      // of flying the width of the area empty between every one.
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

/** Ground distance along a path, metres. */
export function pathLengthM(points: readonly GeoPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const l = toLocal(points[i]!, points[i - 1]!)
    total += Math.hypot(l.e, l.n)
  }
  return total
}
