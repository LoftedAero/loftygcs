import { newUid, type MissionPlan, type PlanItem } from '../protocol/mission-plan'
import { newFenceUid } from '../protocol/geofence'
import { commandLabel } from '../protocol/mission-commands'
import { useMissionStore, type PlanKind } from '../stores/mission-store'
import {
  areasToKml,
  fitPath,
  parseGeoFile,
  pointsToGpx,
  pointsToKml,
  routeToGpx,
  routeToKml,
  type ExportPoint,
  type GeoFix,
  type GeoShape,
} from './geo-file'

// KML and GPX, joined to the three plans Mission mode edits.
//
// What an import becomes is decided by the plan being edited, not by the
// file: waypoints on Mission, boundaries on Fence, rally points on Rally.
//
// The only things worth asking are whether a fence keeps the vehicle in or
// out, which the file cannot say, and what to do when the file holds nothing
// of the kind being imported.
//
// Everything is capped and simplified on the way in: a GPX track is a fix a
// second, and an hour of it would be 3,600 waypoints.

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

/** What is being edited decides what an import becomes. */
export function destinationFor(editing: PlanKind): GeoDestination {
  if (editing === 'fence') return 'fence'
  if (editing === 'rally') return 'rally'
  return 'waypoints'
}

/**
 * The shapes in a file that suit where they are going.
 *
 * A fence wants closed areas; a mission wants lines and points. A file often
 * holds both.
 */
export function usableShapes(shapes: readonly GeoShape[], dest: GeoDestination): GeoShape[] {
  if (dest === 'fence') return shapes.filter((s) => s.kind === 'polygon')
  return shapes.filter((s) => s.kind !== 'polygon')
}

const toWire = (f: GeoFix) => ({ x: Math.round(f.lat * 1e7), y: Math.round(f.lon * 1e7) })

/**
 * What a relative altitude of zero is worth, or null when nothing says.
 *
 * Only the vehicle's own home carries an elevation. A home placed on the map
 * has zero, which must not be read as sea level.
 */
function homeAmsl(plan: MissionPlan): number | null {
  return plan.home && plan.home.z !== 0 ? plan.home.z : null
}

export interface ApplyOptions {
  /** Fences only: keep the vehicle in, or out. The file cannot say. */
  inclusive?: boolean
  /** Force a destination the shapes would not otherwise go to. */
  as?: GeoDestination
}

/**
 * Apply every shape at once.
 *
 * Several tracks are stitched into one route in file order, since a path
 * drawn in Google Earth comes back in the pieces it was drawn in. Several
 * polygons become several fence shapes.
 */
export function applyGeoShapes(
  shapes: readonly GeoShape[],
  fileName: string,
  opts: ApplyOptions = {},
): string {
  const store = useMissionStore.getState()
  const dest = opts.as ?? destinationFor(store.editing)
  const from = shapes.reduce((n, s) => n + s.fixes.length, 0)
  const said = (kept: number, what: string) =>
    kept < from ? `${what} (simplified from ${from} points)` : what

  if (dest === 'fence') {
    const added = shapes.map((shape) => ({
      uid: newFenceUid(),
      kind: 'polygon' as const,
      inclusive: opts.inclusive ?? true,
      points: fitPath(shape.fixes, MAX_FENCE_POINTS).map(toWire),
    }))
    store.setFence({ ...store.fence, shapes: [...store.fence.shapes, ...added] })
    const points = added.reduce((n, a) => n + a.points.length, 0)
    return said(
      points,
      `Added ${added.length} fence ${added.length === 1 ? 'polygon' : 'polygons'}`,
    )
  }

  if (dest === 'rally') {
    const fixes = fitPath(
      shapes.flatMap((s) => s.fixes),
      MAX_RALLY_POINTS,
    )
    for (const f of fixes) store.addRally(toWire(f))
    return said(fixes.length, `Added ${fixes.length} rally points`)
  }

  if (dest === 'survey') {
    const fixes = fitPath(shapes[0]?.fixes ?? [], MAX_SURVEY_POINTS)
    store.startSurvey()
    for (const f of fixes) useMissionStore.getState().addSurveyVertex(toWire(f))
    return said(fixes.length, `Drew a ${fixes.length}-corner survey area`)
  }

  const fixes = fitPath(
    shapes.flatMap((s) => s.fixes),
    MAX_IMPORT_ITEMS,
  )
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
 * A file's elevation is AMSL, so it is used directly only in the AMSL frame;
 * the relative frame needs a known home elevation. Otherwise the editor's
 * default altitude is used.
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
    // Attached to the document: some browsers ignore a detached input's
    // click, and tests cannot reach one.
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
    // Terrain-frame altitudes are not converted, since the ground height is
    // not known here.
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
    // Without a surveyed home, altitudes can only be relative.
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

/** The fence's polygons, as areas. Circles have no KML equivalent. */
function exportAreas(name: string) {
  return useMissionStore
    .getState()
    .fence.shapes.filter((s) => s.kind === 'polygon')
    .map((s, i) => ({
      name: `${name} ${i + 1}`,
      points: s.points.map((p) => ({
        lat: p.x / 1e7,
        lon: p.y / 1e7,
        amslM: 0,
        label: '',
      })),
    }))
}

function exportRally(): ExportPoint[] {
  const base = homeAmsl(useMissionStore.getState().plan) ?? 0
  return useMissionStore.getState().rally.map((r, i) => ({
    lat: r.x / 1e7,
    lon: r.y / 1e7,
    amslM: base + r.altM,
    label: `Rally ${i + 1}`,
  }))
}

/**
 * Whether there is anything to write, and whether GPX can hold it.
 *
 * GPX cannot express an area, so a fence exports as KML only.
 */
export function exportable(editing: PlanKind): { kml: boolean; gpx: boolean } {
  const store = useMissionStore.getState()
  if (editing === 'fence') {
    const areas = store.fence.shapes.some((s) => s.kind === 'polygon')
    return { kml: areas, gpx: false }
  }
  if (editing === 'rally') {
    const any = store.rally.length > 0
    return { kml: any, gpx: any }
  }
  const any = store.plan.items.length > 0
  return { kml: any, gpx: any }
}

/** Whatever plan is on screen, as a KML for Google Earth. */
export function saveKml(name = 'plan.kml'): void {
  const editing = useMissionStore.getState().editing
  const stem = name.replace(/\.kml$/i, '')
  const text =
    editing === 'fence'
      ? areasToKml(stem, exportAreas(stem))
      : editing === 'rally'
        ? pointsToKml(stem, exportRally())
        : routeToKml(exportRoute(stem))
  download(text, name, 'application/vnd.google-earth.kml+xml')
}

/** The same, as GPX. Fences are not offered; see `exportable`. */
export function saveGpx(name = 'plan.gpx'): void {
  const editing = useMissionStore.getState().editing
  const stem = name.replace(/\.gpx$/i, '')
  const text =
    editing === 'rally' ? pointsToGpx(stem, exportRally()) : routeToGpx(exportRoute(stem))
  download(text, name, 'application/gpx+xml')
}
