// KML and GPX: the two formats everything else in the world speaks.
//
// A route arrives as a track someone walked, a boundary drawn in Google
// Earth, or a survey area a client sent -- and it leaves as something that
// can be dropped on Google Earth to show where the aircraft is going. None
// of that is MAVLink, so none of it belongs in `protocol`; it also wants a
// real XML parser, and DOMParser is one that already ships in both the
// browser and Electron. Hand-rolling one over regular expressions is how
// you discover CDATA, entities and namespaces one bug report at a time.
//
// Read permissively, write strictly: files in the wild come from a dozen
// tools and half of them bend the spec, but what leaves here should open in
// Google Earth without an argument.

export interface GeoFix {
  lat: number
  lon: number
  /** Meters above mean sea level, or null when the file carries none. */
  amslM: number | null
}

export interface GeoShape {
  kind: 'track' | 'points' | 'polygon'
  name: string | null
  fixes: GeoFix[]
}

const num = (v: string | null | undefined): number => Number(v ?? NaN)

function elements(root: ParentNode, local: string): Element[] {
  // By local name, so a gx:-prefixed or oddly namespaced document still
  // matches: getElementsByTagName compares the qualified name, and KML in
  // the wild is written with every prefix anyone has thought of.
  return [...root.querySelectorAll('*')].filter((el) => el.localName === local)
}

function firstText(el: Element, local: string): string | null {
  const found = elements(el, local)[0]
  return found?.textContent?.trim() ?? null
}

const sameFix = (a: GeoFix, b: GeoFix) =>
  Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9

/**
 * KML packs a whole geometry into one string: `lon,lat[,alt]` triples
 * separated by any whitespace. Longitude first, which is the single most
 * common way to get a KML import wrong.
 */
function parseKmlCoordinates(text: string): GeoFix[] {
  const out: GeoFix[] = []
  for (const chunk of text.trim().split(/\s+/)) {
    if (chunk === '') continue
    const parts = chunk.split(',')
    const lon = num(parts[0])
    const lat = num(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const alt = parts.length > 2 ? num(parts[2]) : NaN
    out.push({ lat, lon, amslM: Number.isFinite(alt) ? alt : null })
  }
  return out
}

function kmlShapes(doc: Document): GeoShape[] {
  const out: GeoShape[] = []
  for (const mark of elements(doc, 'Placemark')) {
    const name = firstText(mark, 'name')
    for (const line of elements(mark, 'LineString')) {
      const fixes = parseKmlCoordinates(elements(line, 'coordinates')[0]?.textContent ?? '')
      if (fixes.length > 1) out.push({ kind: 'track', name, fixes })
    }
    for (const ring of elements(mark, 'LinearRing')) {
      const fixes = parseKmlCoordinates(elements(ring, 'coordinates')[0]?.textContent ?? '')
      // KML closes a ring by repeating the first vertex; a fence does not.
      if (fixes.length > 3 && sameFix(fixes[0]!, fixes[fixes.length - 1]!)) fixes.pop()
      if (fixes.length > 2) out.push({ kind: 'polygon', name, fixes })
    }
    // gx:Track keeps each position in its own element, space separated and
    // in the same lon-lat-alt order.
    const coords = elements(mark, 'coord')
    if (coords.length > 1) {
      const fixes: GeoFix[] = []
      for (const c of coords) {
        const [lon, lat, alt] = (c.textContent ?? '').trim().split(/\s+/).map(Number)
        if (
          lat !== undefined &&
          lon !== undefined &&
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          fixes.push({ lat, lon, amslM: alt !== undefined && Number.isFinite(alt) ? alt : null })
        }
      }
      if (fixes.length > 1) out.push({ kind: 'track', name, fixes })
    }
    const points = elements(mark, 'Point')
    if (points.length > 0) {
      const fixes = points.flatMap((p) =>
        parseKmlCoordinates(elements(p, 'coordinates')[0]?.textContent ?? ''),
      )
      if (fixes.length > 0) out.push({ kind: 'points', name, fixes })
    }
  }
  return out
}

function gpxFix(el: Element): GeoFix | null {
  const lat = num(el.getAttribute('lat'))
  const lon = num(el.getAttribute('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const ele = firstText(el, 'ele')
  const amslM = ele === null ? NaN : num(ele)
  return { lat, lon, amslM: Number.isFinite(amslM) ? amslM : null }
}

function gpxShapes(doc: Document): GeoShape[] {
  const out: GeoShape[] = []
  for (const rte of elements(doc, 'rte')) {
    const fixes = elements(rte, 'rtept')
      .map(gpxFix)
      .filter((f): f is GeoFix => f !== null)
    if (fixes.length > 1) out.push({ kind: 'track', name: firstText(rte, 'name'), fixes })
  }
  for (const trk of elements(doc, 'trk')) {
    // Segments are joined: a track split by a lost fix is still one route,
    // and a mission cannot express the gap anyway.
    const fixes = elements(trk, 'trkpt')
      .map(gpxFix)
      .filter((f): f is GeoFix => f !== null)
    if (fixes.length > 1) out.push({ kind: 'track', name: firstText(trk, 'name'), fixes })
  }
  const waypoints = [...doc.documentElement.children]
    .filter((el) => el.localName === 'wpt')
    .map(gpxFix)
    .filter((f): f is GeoFix => f !== null)
  if (waypoints.length > 0) out.push({ kind: 'points', name: null, fixes: waypoints })
  return out
}

/**
 * Everything usable in a KML or GPX file, in the order it appears.
 *
 * The format is decided by the root element rather than the extension: a
 * `.txt` from a mapping tool is routinely one or the other, and the
 * extension is the least reliable thing about a file someone emailed.
 */
export function parseGeoFile(text: string): GeoShape[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Not readable as XML. A .kmz is a zipped KML and has to be unzipped first.')
  }
  const root = doc.documentElement.localName
  if (root === 'kml') return kmlShapes(doc)
  if (root === 'gpx') return gpxShapes(doc)
  throw new Error(`Not a KML or GPX file: the document starts with <${root}>`)
}

// ------------------------------------------------------------- simplifying

const EARTH_R = 6378137

/** Meters east and north of an origin; good enough over a route's span. */
function local(p: GeoFix, origin: GeoFix): { e: number; n: number } {
  const latRad = (origin.lat * Math.PI) / 180
  return {
    e: ((p.lon - origin.lon) * Math.PI * EARTH_R * Math.cos(latRad)) / 180,
    n: ((p.lat - origin.lat) * Math.PI * EARTH_R) / 180,
  }
}

/**
 * Douglas-Peucker: drop the points that do not change the shape.
 *
 * A GPS track is a fix a second and a mission is a few dozen waypoints, so
 * something has to go. Dropping every Nth point throws away corners and
 * keeps straights; this keeps whatever is furthest from the line, which is
 * what every mapping tool does and for the same reason.
 */
export function simplifyPath(fixes: readonly GeoFix[], toleranceM: number): GeoFix[] {
  if (fixes.length < 3) return [...fixes]
  const origin = fixes[0]!
  const pts = fixes.map((f) => local(f, origin))
  const keep = new Array<boolean>(fixes.length).fill(false)
  keep[0] = true
  keep[fixes.length - 1] = true

  const stack: [number, number][] = [[0, fixes.length - 1]]
  while (stack.length > 0) {
    const [from, to] = stack.pop()!
    const a = pts[from]!
    const b = pts[to]!
    const dx = b.e - a.e
    const dy = b.n - a.n
    const len = Math.hypot(dx, dy)
    let worst = -1
    let worstAt = -1
    for (let i = from + 1; i < to; i++) {
      const p = pts[i]!
      // Distance to the segment; a zero-length one degenerates to the
      // distance from its single point, which is what a closed loop needs.
      const d =
        len === 0
          ? Math.hypot(p.e - a.e, p.n - a.n)
          : Math.abs(dy * (p.e - a.e) - dx * (p.n - a.n)) / len
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }
    if (worst > toleranceM && worstAt > 0) {
      keep[worstAt] = true
      stack.push([from, worstAt], [worstAt, to])
    }
  }
  return fixes.filter((_, i) => keep[i])
}

/**
 * Simplify until the path fits.
 *
 * The tolerance that reduces a hand-drawn line to twenty points and the one
 * that does the same to an hour of GPS fixes differ by orders of magnitude,
 * so it is found rather than guessed: start tight and loosen until it fits.
 * Douglas-Peucker is monotone in tolerance and bottoms out at the two ends,
 * so this always terminates -- which is why it can be a loop rather than a
 * search with a give-up case.
 */
export function fitPath(fixes: readonly GeoFix[], maxPoints: number): GeoFix[] {
  const cap = Math.max(2, maxPoints)
  if (fixes.length <= cap) return [...fixes]
  let tolerance = 1
  let out = simplifyPath(fixes, tolerance)
  while (out.length > cap) {
    tolerance *= 2
    out = simplifyPath(fixes, tolerance)
  }
  return out
}

// ----------------------------------------------------------------- writing

export interface ExportPoint {
  lat: number
  lon: number
  /** Meters above mean sea level: both formats are absolute. */
  amslM: number
  label: string
}

export interface ExportRoute {
  name: string
  points: readonly ExportPoint[]
  /**
   * How the altitudes should be read. A mission planned in the relative
   * frame with no surveyed home has no true elevation to write, and saying
   * `relativeToGround` is honest where writing the relative number as an
   * absolute one would bury the route under the hillside in Google Earth.
   */
  altitudeMode?: 'absolute' | 'relativeToGround'
}

const XML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
}

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => XML_ESCAPES[c] ?? c)

const coord = (p: ExportPoint) => `${p.lon.toFixed(7)},${p.lat.toFixed(7)},${p.amslM.toFixed(1)}`

/**
 * The route as Google Earth reads it.
 *
 * `altitudeMode` absolute with `extrude` draws the wall down to the ground
 * that makes a flight path readable in 3D; without it the line floats and
 * nobody can tell how high it is. The color is the house orange in KML's
 * own aabbggrr order.
 */
export function routeToKml(route: ExportRoute): string {
  const mode = route.altitudeMode ?? 'absolute'
  const marks = route.points
    .map(
      (p) =>
        `    <Placemark>\n      <name>${escapeXml(p.label)}</name>\n` +
        `      <Point><altitudeMode>${mode}</altitudeMode>` +
        `<coordinates>${coord(p)}</coordinates></Point>\n    </Placemark>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(route.name)}</name>
    <Style id="route">
      <LineStyle><color>ff1d94f7</color><width>3</width></LineStyle>
      <PolyStyle><color>401d94f7</color></PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(route.name)}</name>
      <styleUrl>#route</styleUrl>
      <LineString>
        <extrude>1</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>${mode}</altitudeMode>
        <coordinates>${route.points.map(coord).join(' ')}</coordinates>
      </LineString>
    </Placemark>
${marks}
  </Document>
</kml>
`
}

/** The route as a GPX route, which is what handhelds and trackers import. */
export function routeToGpx(route: ExportRoute): string {
  const points = route.points
    .map(
      (p) =>
        `    <rtept lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">\n` +
        `      <ele>${p.amslM.toFixed(1)}</ele>\n` +
        `      <name>${escapeXml(p.label)}</name>\n    </rtept>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Loft GCS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(route.name)}</name></metadata>
  <rte>
    <name>${escapeXml(route.name)}</name>
${points}
  </rte>
</gpx>
`
}
