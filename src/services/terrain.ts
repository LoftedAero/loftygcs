import { getTile, hasTile, prefetchTiles, putTile } from './tile-cache'
import { countTiles, tilesForBounds, tileUrl, type LatLonBounds, type TileCoord } from './tile-math'
import {
  decodeElevation,
  gridKey,
  TERRAIN_TILE_PX,
  TERRAIN_ZOOM,
  terrainTilesFor,
  type LatLon,
  type TerrainGrids,
} from './terrain-math'

// Where ground elevation comes from.
//
// Terrarium tiles from AWS's public elevation-tiles-prod bucket: no key, no
// rate limit to negotiate, CORS open, and the same SRTM/NED measurements
// ArduPilot's own terrain server is built from -- checked against Everest,
// Badwater and two flying fields before this was written, not assumed.
//
// They are tiles, so they go through the offline cache the map already
// uses. Downloading an area for a trip therefore brings its terrain along
// at zoom 12, where a field is one or two tiles.
//
// Everything degrades: no network and nothing cached means no terrain, and
// every caller has to draw the case where the answer is null. A profile
// that silently invents ground is worse than one that says it has none.

export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Its data sources require credit; the string travels with the source. */
export const TERRAIN_ATTRIBUTION = 'Elevation: SRTM, USGS NED, GMTED via AWS Terrain Tiles'

/** The offline cache namespace, kept apart from the imagery layers. */
export const TERRAIN_LAYER_ID = 'terrain'

// Decoded tiles are held in memory: a mission profile resamples the same
// ground on every edit, and re-decoding a PNG per keystroke is the
// difference between a profile that follows the drag and one that lags it.
// A quarter of a megabyte each, so the oldest is dropped past the cap --
// the compressed tile is still in the offline cache, so a dropped one costs
// a decode, not a download.
const MAX_DECODED = 48
const decoded = new Map<string, Float32Array>()
const inFlight = new Map<string, Promise<Float32Array | null>>()

async function toGrid(blob: Blob): Promise<Float32Array | null> {
  if (typeof createImageBitmap !== 'function') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  try {
    const ctx = canvasFor(bitmap.width, bitmap.height)
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const out = new Float32Array(TERRAIN_TILE_PX * TERRAIN_TILE_PX)
    for (let i = 0; i < out.length; i++) {
      const p = i * 4
      out[i] = decodeElevation(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0)
    }
    return out
  } catch {
    // A tainted or oversized canvas: no terrain rather than a broken page.
    return null
  } finally {
    bitmap.close()
  }
}

function canvasFor(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas === 'function') {
    const ctx = new OffscreenCanvas(w, h).getContext('2d')
    return (ctx as unknown as CanvasRenderingContext2D) ?? null
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas.getContext('2d')
}

function loadTile(t: TileCoord): Promise<Float32Array | null> {
  const key = gridKey(t)
  const held = decoded.get(key)
  if (held) return Promise.resolve(held)
  const pending = inFlight.get(key)
  if (pending) return pending
  const work = (async () => {
    let blob = await getTile(TERRAIN_LAYER_ID, t)
    if (!blob) {
      try {
        const res = await fetch(tileUrl(TERRAIN_URL, t))
        if (!res.ok) return null
        blob = await res.blob()
        void putTile(TERRAIN_LAYER_ID, t, blob)
      } catch {
        return null
      }
    }
    const grid = await toGrid(blob)
    if (grid) {
      decoded.set(key, grid)
      // Map iterates in insertion order, so the first key is the oldest.
      while (decoded.size > MAX_DECODED) {
        const oldest = decoded.keys().next().value
        if (oldest === undefined) break
        decoded.delete(oldest)
      }
    }
    return grid
  })()
  inFlight.set(key, work)
  void work.finally(() => inFlight.delete(key))
  return work
}

/**
 * The decoded tiles covering these coordinates.
 *
 * Fetched together rather than one lookup at a time so a route of two
 * hundred samples over one tile is one request, and so the caller can hand
 * the whole set to `sampleElevation` synchronously afterwards.
 */
export async function loadTerrain(points: readonly LatLon[]): Promise<TerrainGrids> {
  return loadTerrainTiles(terrainTilesFor(points))
}

/**
 * The same, for a caller that already knows its tiles -- which is how the
 * profile avoids refetching: dragging a waypoint changes the samples on
 * every frame but almost never changes the tile they land in.
 */
export async function loadTerrainTiles(tiles: readonly TileCoord[]): Promise<TerrainGrids> {
  const grids = new Map<string, Float32Array>()
  await Promise.all(
    tiles.map(async (t) => {
      const grid = await loadTile(t)
      if (grid) grids.set(gridKey(t), grid)
    }),
  )
  return grids
}

/**
 * As many terrain tiles as an area may ask for.
 *
 * A flying field is one or two, a county is a handful. The whole world at
 * this zoom is 341,598 -- which is what the map shows before anyone has
 * moved it, and what this cap exists for: without it, opening Mission mode
 * asked the cache about every terrain tile on Earth (starving every other
 * read on the page) and offered to download thirty gigabytes of them.
 * Sixty-four covers about eight hundred kilometers on a side, which is
 * further than anything flies in one trip.
 */
export const MAX_AREA_TERRAIN_TILES = 64

/**
 * The tiles an area needs, for the offline download to fetch alongside the
 * map. Covering the whole rectangle rather than its corners: a view wider
 * than a terrain tile would otherwise come back with a hole in the middle.
 *
 * An area past the cap returns nothing rather than a truncated list: there
 * is no useful terrain answer for a continent, and half of one would be a
 * profile with a hole in it that nothing explains.
 */
export function terrainTilesForArea(bounds: LatLonBounds): TileCoord[] {
  // Counted before it is built: the list for a world view is a third of a
  // million objects, and constructing them only to throw them away is a
  // visible pause on the way to answering "no".
  if (countTiles(bounds, TERRAIN_ZOOM, TERRAIN_ZOOM) > MAX_AREA_TERRAIN_TILES) return []
  return tilesForBounds(bounds, TERRAIN_ZOOM, TERRAIN_ZOOM)
}

/**
 * Keep elevation for wherever the mission map is looking.
 *
 * The imagery stores itself as a side effect of being drawn, which made a
 * half-promise: pan your field at home and the *map* works at the no-signal
 * field, but the terrain profile there reads "unavailable", because nothing
 * ever displayed an elevation tile to store on the way past. So the settled
 * view prefetches its own -- genuine speculative fetching, unlike the
 * imagery, and cheap by construction: terrain is one fixed zoom whose tiles
 * span ten kilometers, so a session touches a handful, already-stored ones
 * are skipped, and the area cap returns nothing for a continent.
 *
 * One run at a time, remembering only the newest ask: pans settle faster
 * than fetches finish, and a queue of every intermediate view would fetch
 * ground nobody stopped on.
 */
let nextView: LatLonBounds | null = null
let prefetching = false

export async function prefetchTerrainForView(bounds: LatLonBounds): Promise<void> {
  nextView = bounds
  if (prefetching) return
  prefetching = true
  try {
    while (nextView) {
      const view = nextView
      nextView = null
      const tiles = terrainTilesForArea(view)
      if (tiles.length > 0) {
        // Two at a time: this is background courtesy traffic, not a download
        // anyone is watching.
        await prefetchTiles(TERRAIN_LAYER_ID, TERRAIN_URL, tiles, () => {}, undefined, 2)
      }
    }
  } finally {
    prefetching = false
  }
}

export interface TerrainCoverage {
  stored: number
  total: number
}

/**
 * How much of an area's terrain is already on this machine.
 *
 * Asked separately from the map's own coverage because the two are
 * genuinely independent: terrain is one zoom level of very large tiles, so
 * an area can have every scrap of imagery and no elevation at all, and the
 * profile would then go quiet at the field with no explanation.
 */
export async function terrainCoverage(bounds: LatLonBounds): Promise<TerrainCoverage> {
  const tiles = terrainTilesForArea(bounds)
  const flags = await Promise.all(tiles.map((t) => hasTile(TERRAIN_LAYER_ID, t)))
  return { stored: flags.filter(Boolean).length, total: tiles.length }
}
