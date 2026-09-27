// KML and GPX import and export.
//
// Lives in `services` rather than `protocol` because it needs DOMParser; a
// regex parser would mishandle CDATA, entities and namespaces.
//
// Read permissively, write strictly: files come from many tools that bend
// the spec, but output should open cleanly in Google Earth.

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
  // By local name, so prefixed elements (gx: and others) still match;
  // getElementsByTagName compares the qualified name.
  return [...root.querySelectorAll('*')].filter((el) => el.localName === local)
}

function firstText(el: Element, local: string): string | null {
  const found = elements(el, local)[0]
  return found?.textContent?.trim() ?? null
}

const sameFix = (a: GeoFix, b: GeoFix) =>
  Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9

/**
 * KML packs a geometry into one string of `lon,lat[,alt]` triples separated
 * by whitespace. Note: longitude first.
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
    // Segments are joined: a mission cannot express the gap anyway.
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
 * Everything usable in a KML or GPX file, in the order it appears. The
 * format is decided by the root element, not the file extension.
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
 * Douglas-Peucker: drop the points that do not change the shape. A GPS
 * track logs a fix a second, far more than a mission can hold.
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
      // Distance to the segment; a zero-length one (a closed loop) uses the
      // distance from its single point.
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
 * Simplify until the path fits, starting with a tight tolerance and
 * loosening it. Douglas-Peucker is monotone in tolerance and bottoms out at
 * the two endpoints, so this always terminates.
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
   * How the altitudes should be read. A relative-frame mission with no
   * surveyed home has no true elevation, so it is written as
   * `relativeToGround`.
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
 * The route as Google Earth reads it. `extrude` draws a wall down to the
 * ground so the height is readable in 3D. The color is the app's orange in
 * KML's aabbggrr order.
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

/**
 * Closed areas, such as a geofence or survey boundary.
 *
 * Written as `<Polygon>` elements so they re-import as areas. KML closes a
 * ring by repeating its first vertex, which a fence does not, so it is
 * added here.
 */
export function areasToKml(name: string, areas: readonly ExportRoute[]): string {
  const marks = areas
    .map((area) => {
      const ring = area.points.length > 0 ? [...area.points, area.points[0]!] : []
      return (
        `    <Placemark>\n      <name>${escapeXml(area.name)}</name>\n` +
        `      <Style><LineStyle><color>ff1d94f7</color><width>3</width></LineStyle>` +
        `<PolyStyle><color>301d94f7</color></PolyStyle></Style>\n` +
        `      <Polygon><outerBoundaryIs><LinearRing>` +
        `<coordinates>${ring.map(coord).join(' ')}</coordinates>` +
        `</LinearRing></outerBoundaryIs></Polygon>\n    </Placemark>`
      )
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${marks}
  </Document>
</kml>
`
}

/** Loose points, such as rally points, as KML. */
export function pointsToKml(name: string, points: readonly ExportPoint[]): string {
  const marks = points
    .map(
      (p) =>
        `    <Placemark>\n      <name>${escapeXml(p.label)}</name>\n` +
        `      <Point><altitudeMode>absolute</altitudeMode>` +
        `<coordinates>${coord(p)}</coordinates></Point>\n    </Placemark>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${marks}
  </Document>
</kml>
`
}

/** The same points as GPX waypoints. */
export function pointsToGpx(name: string, points: readonly ExportPoint[]): string {
  const body = points
    .map(
      (p) =>
        `  <wpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">\n` +
        `    <ele>${p.amslM.toFixed(1)}</ele>\n` +
        `    <name>${escapeXml(p.label)}</name>\n  </wpt>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Loft GCS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
${body}
</gpx>
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
