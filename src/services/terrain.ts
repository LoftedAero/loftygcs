import { getTile, putTile } from './tile-cache'
import { tilesForBounds, tileUrl, type LatLonBounds, type TileCoord } from './tile-math'
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

export const TERRAIN_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

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
 * The tiles an area needs, for the offline download to fetch alongside the
 * map. Covering the whole rectangle rather than its corners: a view wider
 * than a terrain tile would otherwise come back with a hole in the middle.
 */
export function terrainTilesForArea(bounds: LatLonBounds): TileCoord[] {
  return tilesForBounds(bounds, TERRAIN_ZOOM, TERRAIN_ZOOM)
}
