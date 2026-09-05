import { newUid, type MissionPlan, type PlanItem } from '../protocol/mission-plan'
import { newFenceUid } from '../protocol/geofence'
import { commandLabel } from '../protocol/mission-commands'
import { useMissionStore } from '../stores/mission-store'
import {
  fitPath,
  parseGeoFile,
  routeToGpx,
  routeToKml,
  type ExportPoint,
  type GeoFix,
  type GeoShape,
} from './geo-file'

// KML and GPX, joined to the three plans Mission mode edits.
//
// What an imported shape *means* is decided by what is being edited, not by
// what the shape is: the same polygon is a survey area while planning a
// mission and a geofence while editing the fence. That is the rule the rest
// of Mission mode already follows -- the switch changes what things mean --
// and it removes a dialog that would otherwise ask a question the screen has
// already answered.
//
// Everything is capped and simplified on the way in. A GPX track is a fix a
// second, ArduPilot's mission storage is not, and importing an hour's walk
// as 3,600 waypoints would be a way of not importing it at all.

/** As many waypoints as an imported track may become. */
export const MAX_IMPORT_ITEMS = 80
/** Fence polygons share FENCE_TOTAL with everything else in the fence. */
const MAX_FENCE_POINTS = 50
const MAX_SURVEY_POINTS = 30
/** Rally points are a handful of alternates, never a route. */
const MAX_RALLY_POINTS = 10

export type GeoDestination = 'waypoints' | 'survey' | 'fence' | 'rally'

export interface GeoFilePick {
  name: string
  shapes: GeoShape[]
}

/**
 * Where a shape goes, given what is being edited.
 *
 * A line drawn in Google Earth is a boundary when the fence is on screen and
 * a route when the mission is; a polygon is a survey area while planning and
 * a fence while fencing. Nobody is asked, because the question was answered
 * by opening that plan.
 */
export function destinationFor(
  shape: GeoShape,
  editing: 'mission' | 'fence' | 'rally',
): GeoDestination {
  if (editing === 'fence') return 'fence'
  if (editing === 'rally') return 'rally'
  return shape.kind === 'polygon' ? 'survey' : 'waypoints'
}

const toWire = (f: GeoFix) => ({ x: Math.round(f.lat * 1e7), y: Math.round(f.lon * 1e7) })

/**
 * What a relative altitude of zero is worth, or null when nothing says.
 *
 * Only the vehicle's own home carries an elevation; a home dropped on the
 * map keeps zero, and reading that as sea level would put an imported track
 * hundreds of meters underground.
 */
function homeAmsl(plan: MissionPlan): number | null {
  return plan.home && plan.home.z !== 0 ? plan.home.z : null
}

/** Applies a shape to whichever plan is being edited. Returns a summary. */
export function applyGeoShape(shape: GeoShape, fileName: string): string {
  const store = useMissionStore.getState()
  const dest = destinationFor(shape, store.editing)
  const from = shape.fixes.length
  const said = (kept: number, what: string) =>
    kept < from ? `${what} (simplified from ${from} points)` : what

  if (dest === 'fence') {
    const fixes = fitPath(shape.fixes, MAX_FENCE_POINTS)
    store.setFence({
      ...store.fence,
      shapes: [
        ...store.fence.shapes,
        { uid: newFenceUid(), kind: 'polygon', inclusive: true, points: fixes.map(toWire) },
      ],
    })
    return said(fixes.length, `Added a ${fixes.length}-point fence polygon`)
  }

  if (dest === 'rally') {
    const fixes = fitPath(shape.fixes, MAX_RALLY_POINTS)
    for (const f of fixes) store.addRally(toWire(f))
    return said(fixes.length, `Added ${fixes.length} rally points`)
  }

  if (dest === 'survey') {
    const fixes = fitPath(shape.fixes, MAX_SURVEY_POINTS)
    store.startSurvey()
    for (const f of fixes) useMissionStore.getState().addSurveyVertex(toWire(f))
    return said(fixes.length, `Drew a ${fixes.length}-corner survey area`)
  }

  const fixes = fitPath(shape.fixes, MAX_IMPORT_ITEMS)
  const { frame, altM } = store.defaults
  const base = homeAmsl(store.plan)
  const items: PlanItem[] = fixes.map((f) => ({
    uid: newUid(),
    frame,
    command: 16,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    ...toWire(f),
    z: altitudeFor(f, frame, altM, base),
  }))
  store.setPlan({ home: store.plan.home, items }, { name: fileName })
  return said(fixes.length, `Loaded ${fixes.length} waypoints`)
}

/**
 * The altitude to give an imported waypoint.
 *
 * A file's elevation is always above sea level, so it is only usable
 * directly in the AMSL frame; converting it to a relative one needs a home
 * elevation nobody may have supplied. Where it cannot be converted the
 * editor's default altitude is used, which is at least a number someone
 * chose -- an imported track flown at whatever height the GPS thought the
 * hiker's wrist was at is not a mission.
 */
function altitudeFor(
  f: GeoFix,
  frame: number,
  defaultAltM: number,
  homeAmslM: number | null,
): number {
  if (f.amslM === null) return defaultAltM
  if (frame === 0) return Math.round(f.amslM)
  if (frame === 3 && homeAmslM !== null) return Math.round(f.amslM - homeAmslM)
  return defaultAltM
}

/** Prompt for a KML or GPX file and parse it. Null means the picker closed. */
export function pickGeoFile(): Promise<GeoFilePick | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.kml,.gpx,.xml'
    // Attached rather than floating: a detached input's click is ignored by
    // some browsers, and a test cannot reach one either.
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const done = (value: GeoFilePick | null) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }
    input.oncancel = () => done(null)
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return done(null)
      try {
        const shapes = parseGeoFile(await file.text())
        input.remove()
        settled = true
        if (shapes.length === 0) {
          reject(new Error(`${file.name} has no tracks, routes or shapes in it`))
          return
        }
        resolve({ name: file.name, shapes })
      } catch (err) {
        settled = true
        input.remove()
        reject(err)
      }
    }
    input.click()
  })
}

// ----------------------------------------------------------------- writing

function exportRoute(name: string) {
  const plan = useMissionStore.getState().plan
  const base = homeAmsl(plan)
  const points: ExportPoint[] = []
  plan.items.forEach((it, i) => {
    if (it.x === 0 && it.y === 0) return
    // Terrain-frame altitudes are left as they are: the height above a hill
    // is not a height above the sea, and guessing at the difference in a
    // file someone will fly against is worse than a route drawn a little
    // low in Google Earth.
    const amslM = it.frame === 0 ? it.z : (base ?? 0) + it.z
    points.push({
      lat: it.x / 1e7,
      lon: it.y / 1e7,
      amslM,
      label: `${i + 1} ${commandLabel(it.command)}`,
    })
  })
  return {
    name,
    points,
    // With no surveyed home there is no elevation to be absolute about.
    altitudeMode: base === null ? ('relativeToGround' as const) : ('absolute' as const),
  }
}

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoked on the next tick: revoking synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  useMissionStore.getState().setTransfer({ kind: 'done', text: `Saved ${name}` })
}

/** The mission as a KML, for Google Earth. */
export function saveKml(name = 'mission.kml'): void {
  download(
    routeToKml(exportRoute(name.replace(/\.kml$/i, ''))),
    name,
    'application/vnd.google-earth.kml+xml',
  )
}

/** The mission as a GPX route, for handhelds and mapping tools. */
export function saveGpx(name = 'mission.gpx'): void {
  download(routeToGpx(exportRoute(name.replace(/\.gpx$/i, ''))), name, 'application/gpx+xml')
}
