import { describe, expect, it } from 'vitest'
import {
  areasToKml,
  fitPath,
  parseGeoFile,
  pointsToGpx,
  pointsToKml,
  routeToGpx,
  routeToKml,
  simplifyPath,
  type ExportRoute,
  type GeoFix,
} from './geo-file'

// Fixtures follow the producing tools: Google Earth writes lon,lat,alt
// triples on one line, a handheld writes GPX with an <ele> per point, and
// both are namespaced. The round-trip tests read back what this writes.

const kml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>${body}</Document>
</kml>`

describe('reading KML', () => {
  it('keeps longitude and latitude the right way round', () => {
    // KML is lon,lat where the rest of the app is lat,lon, and a swapped
    // pair still parses.
    const shapes = parseGeoFile(
      kml(`<Placemark><name>Leg</name><LineString><coordinates>
        -105.25,39.95,1900 -105.30,39.96,2000
      </coordinates></LineString></Placemark>`),
    )
    expect(shapes).toHaveLength(1)
    expect(shapes[0]!.kind).toBe('track')
    expect(shapes[0]!.name).toBe('Leg')
    expect(shapes[0]!.fixes[0]).toEqual({ lat: 39.95, lon: -105.25, amslM: 1900 })
    expect(shapes[0]!.fixes[1]).toEqual({ lat: 39.96, lon: -105.3, amslM: 2000 })
  })

  it('reads a coordinate with no altitude as having none', () => {
    const [shape] = parseGeoFile(
      kml(`<Placemark><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark>`),
    )
    expect(shape!.fixes.every((f) => f.amslM === null)).toBe(true)
  })

  it('opens a polygon ring, because a fence does not repeat its first vertex', () => {
    const [shape] = parseGeoFile(
      kml(`<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
        1,1 2,1 2,2 1,2 1,1
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`),
    )
    expect(shape!.kind).toBe('polygon')
    expect(shape!.fixes).toHaveLength(4)
  })

  it('reads points and gx:Track', () => {
    const shapes = parseGeoFile(
      kml(
        `<Placemark><name>Field</name><Point><coordinates>-88.8286,40.1236,220</coordinates></Point></Placemark>` +
          `<Placemark><gx:Track><gx:coord>-88.8 40.1 300</gx:coord><gx:coord>-88.7 40.2 310</gx:coord></gx:Track></Placemark>`,
      ),
    )
    // gx:coord is space separated where <coordinates> is comma separated.
    expect(shapes.map((s) => s.kind)).toEqual(['points', 'track'])
    const track = shapes.find((s) => s.kind === 'track')!
    expect(track.fixes[0]).toEqual({ lat: 40.1, lon: -88.8, amslM: 300 })
    const point = shapes.find((s) => s.kind === 'points')!
    expect(point.fixes[0]!.lat).toBeCloseTo(40.1236, 6)
  })

  it('says what is wrong rather than returning nothing', () => {
    expect(() => parseGeoFile('not xml at all <')).toThrow(/kmz|XML/i)
    expect(() => parseGeoFile('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(
      /Not a KML or GPX file/,
    )
  })
})

describe('reading GPX', () => {
  const gpx = (body: string) =>
    `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`

  it('reads a route with elevations', () => {
    const [shape] = parseGeoFile(
      gpx(`<rte><name>Ridge</name>
        <rtept lat="39.95" lon="-105.25"><ele>1900</ele></rtept>
        <rtept lat="39.96" lon="-105.30"><ele>2000.5</ele></rtept>
      </rte>`),
    )
    expect(shape!.name).toBe('Ridge')
    expect(shape!.fixes).toEqual([
      { lat: 39.95, lon: -105.25, amslM: 1900 },
      { lat: 39.96, lon: -105.3, amslM: 2000.5 },
    ])
  })

  it('joins the segments of a track', () => {
    const [shape] = parseGeoFile(
      gpx(`<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/></trkseg>
        <trkseg><trkpt lat="3" lon="3"/></trkseg></trk>`),
    )
    // A track split by a lost fix is still one route.
    expect(shape!.fixes).toHaveLength(3)
  })

  it('collects loose waypoints, and only the top-level ones', () => {
    const shapes = parseGeoFile(
      gpx(`<wpt lat="1" lon="1"><name>A</name></wpt><wpt lat="2" lon="2"/>
        <rte><rtept lat="5" lon="5"/><rtept lat="6" lon="6"/></rte>`),
    )
    const points = shapes.find((s) => s.kind === 'points')!
    expect(points.fixes).toHaveLength(2)
    expect(shapes.find((s) => s.kind === 'track')!.fixes).toHaveLength(2)
  })
})

describe('simplifying a path', () => {
  /** A straight run of `n` fixes a meter apart, heading north. */
  const line = (n: number, from = 0): GeoFix[] =>
    Array.from({ length: n }, (_, i) => ({
      lat: 40 + (i + from) * 9e-6,
      lon: -88,
      amslM: null,
    }))

  it('collapses a straight line to its ends', () => {
    expect(simplifyPath(line(50), 5)).toHaveLength(2)
  })

  it('keeps a corner', () => {
    const corner: GeoFix[] = [
      { lat: 40, lon: -88, amslM: null },
      { lat: 40.01, lon: -88, amslM: null },
      { lat: 40.01, lon: -87.99, amslM: null },
    ]
    expect(simplifyPath(corner, 5)).toHaveLength(3)
  })

  it('respects the tolerance', () => {
    // A 20 m bulge survives a 5 m tolerance and does not survive a 50 m one.
    const bulge: GeoFix[] = [
      { lat: 40, lon: -88, amslM: null },
      { lat: 40.0001, lon: -87.9998, amslM: null },
      { lat: 40, lon: -87.9996, amslM: null },
    ]
    expect(simplifyPath(bulge, 5)).toHaveLength(3)
    expect(simplifyPath(bulge, 50)).toHaveLength(2)
  })

  it('never drops the ends, whatever the tolerance', () => {
    const path = line(30)
    const out = simplifyPath(path, 1e6)
    expect(out[0]).toEqual(path[0])
    expect(out[out.length - 1]).toEqual(path[path.length - 1])
  })

  it('fits a long track into a mission-sized list', () => {
    // An hour of one-second fixes.
    const track = line(3600)
    const fitted = fitPath(track, 50)
    expect(fitted.length).toBeLessThanOrEqual(50)
    expect(fitted[0]).toEqual(track[0])
    expect(fitted[fitted.length - 1]).toEqual(track[track.length - 1])
  })

  it('reduces a receiver left on the bench to its two ends', () => {
    // Loosening the tolerance bottoms out at the two ends rather than failing
    // to converge.
    const stuck: GeoFix[] = Array.from({ length: 1000 }, () => ({
      lat: 40,
      lon: -88,
      amslM: null,
    }))
    expect(fitPath(stuck, 40)).toHaveLength(2)
  })

  it('leaves a path that already fits alone', () => {
    const path = line(10)
    expect(fitPath(path, 50)).toEqual(path)
  })
})

describe('writing', () => {
  const route: ExportRoute = {
    name: 'Ridge & Valley <test>',
    points: [
      { lat: 39.95, lon: -105.25, amslM: 2000, label: '1 Takeoff' },
      { lat: 39.96, lon: -105.3, amslM: 2100, label: '2 Waypoint' },
      { lat: 39.97, lon: -105.35, amslM: 2100, label: '3 Land' },
    ],
  }

  it('writes KML this parser reads back unchanged', () => {
    const shapes = parseGeoFile(routeToKml(route))
    const track = shapes.find((s) => s.kind === 'track')!
    expect(track.fixes).toHaveLength(3)
    track.fixes.forEach((f, i) => {
      expect(f.lat).toBeCloseTo(route.points[i]!.lat, 7)
      expect(f.lon).toBeCloseTo(route.points[i]!.lon, 7)
      expect(f.amslM).toBeCloseTo(route.points[i]!.amslM, 1)
    })
    // One placemark per waypoint, so the numbers show in Google Earth.
    expect(shapes.filter((s) => s.kind === 'points')).toHaveLength(3)
  })

  it('writes GPX this parser reads back unchanged', () => {
    const [shape] = parseGeoFile(routeToGpx(route))
    expect(shape!.fixes).toHaveLength(3)
    expect(shape!.fixes[2]!.lon).toBeCloseTo(-105.35, 7)
    expect(shape!.fixes[2]!.amslM).toBeCloseTo(2100, 1)
  })

  it('escapes a name that would otherwise break the document', () => {
    // Written raw, this produces a file Google Earth refuses to open.
    const [shape] = parseGeoFile(routeToGpx(route))
    expect(shape!.name).toBe('Ridge & Valley <test>')
    expect(routeToKml(route)).toContain('&amp;')
  })

  it('marks altitudes absolute, or Google Earth lays the route on the ground', () => {
    expect(routeToKml(route)).toContain('<altitudeMode>absolute</altitudeMode>')
  })
})

describe('writing a fence and rally points', () => {
  const area: ExportRoute = {
    name: 'Field boundary',
    points: [
      { lat: 39.95, lon: -105.25, amslM: 0, label: '' },
      { lat: 39.96, lon: -105.25, amslM: 0, label: '' },
      { lat: 39.96, lon: -105.24, amslM: 0, label: '' },
      { lat: 39.95, lon: -105.24, amslM: 0, label: '' },
    ],
  }

  it('writes an area this parser reads back as an area', () => {
    // A closed LineString would re-import as a mission track, not a fence.
    const [shape] = parseGeoFile(areasToKml('fence', [area]))
    expect(shape!.kind).toBe('polygon')
  })

  it('closes the ring, which a fence does not carry', () => {
    // KML repeats the first vertex to close a ring; the fence does not.
    const kml = areasToKml('fence', [area])
    expect(kml.match(/-105\.25/g)).toHaveLength(3)
    const [shape] = parseGeoFile(kml)
    expect(shape!.fixes[0]!.lat).toBeCloseTo(39.95, 7)
    expect(shape!.fixes[0]!.lon).toBeCloseTo(-105.25, 7)
  })

  it('writes rally points as points, in both formats', () => {
    const points = [
      { lat: 39.95, lon: -105.25, amslM: 1950, label: 'Rally 1' },
      { lat: 39.97, lon: -105.2, amslM: 1980, label: 'Rally 2' },
    ]
    for (const text of [pointsToKml('rally', points), pointsToGpx('rally', points)]) {
      const shapes = parseGeoFile(text)
      const fixes = shapes.flatMap((sh) => sh.fixes)
      expect(fixes).toHaveLength(2)
      expect(fixes[1]!.lat).toBeCloseTo(39.97, 7)
      expect(fixes[1]!.amslM).toBeCloseTo(1980, 1)
      expect(shapes.every((sh) => sh.kind === 'points')).toBe(true)
    }
  })
})
