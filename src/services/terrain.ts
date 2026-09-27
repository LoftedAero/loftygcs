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
// Terrarium tiles from AWS's public elevation-tiles-prod bucket: no key,
// CORS open, and the same SRTM/NED data ArduPilot's terrain server is built
// from.
//
// They go through the map's offline cache, so downloading an area also
// brings its terrain at zoom 12, where a field is one or two tiles.
//
// With no network and nothing cached there is no terrain, and every caller
// must handle a null answer rather than invent ground.

export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Its data sources require credit; the string travels with the source. */
export const TERRAIN_ATTRIBUTION = 'Elevation: SRTM, USGS NED, GMTED via AWS Terrain Tiles'

/** The offline cache namespace, kept apart from the imagery layers. */
export const TERRAIN_LAYER_ID = 'terrain'

// Decoded tiles are held in memory because a mission profile resamples the
// same ground on every edit. Each is a quarter of a megabyte, so the oldest
// is dropped past the cap; the compressed tile stays in the offline cache.
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
 * Fetched together so many samples over one tile make one request, and the
 * caller can then pass the set to `sampleElevation` synchronously.
 */
export async function loadTerrain(points: readonly LatLon[]): Promise<TerrainGrids> {
  return loadTerrainTiles(terrainTilesFor(points))
}

/**
 * The same, for a caller that already knows its tiles. Dragging a waypoint
 * changes the samples every frame but rarely the tiles they land in.
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
 * A flying field is one or two tiles. The whole world at this zoom is
 * 341,598, which is what the map shows before it is moved. Sixty-four covers
 * about 800 km on a side.
 */
export const MAX_AREA_TERRAIN_TILES = 64

/**
 * The tiles covering an area, for the offline download to fetch alongside
 * the map.
 *
 * An area past the cap returns nothing rather than a truncated list, which
 * would leave an unexplained hole in the profile.
 */
export function terrainTilesForArea(bounds: LatLonBounds): TileCoord[] {
  // Count before building: a world view would be a third of a million tiles.
  if (countTiles(bounds, TERRAIN_ZOOM, TERRAIN_ZOOM) > MAX_AREA_TERRAIN_TILES) return []
  return tilesForBounds(bounds, TERRAIN_ZOOM, TERRAIN_ZOOM)
}

/**
 * Keep elevation for wherever the mission map is looking.
 *
 * Imagery is cached as a side effect of being drawn, but elevation tiles
 * are never displayed, so the settled view prefetches them. This stays
 * cheap: one fixed zoom with ten-kilometer tiles, stored tiles skipped, and
 * nothing past the area cap.
 *
 * One run at a time, keeping only the newest request, so intermediate views
 * during a pan are not fetched.
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
        // Two at a time: this is background traffic.
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
 * Separate from imagery coverage: an area can have all its imagery cached
 * and no elevation at all.
 */
export async function terrainCoverage(bounds: LatLonBounds): Promise<TerrainCoverage> {
  const tiles = terrainTilesForArea(bounds)
  const flags = await Promise.all(tiles.map((t) => hasTile(TERRAIN_LAYER_ID, t)))
  return { stored: flags.filter(Boolean).length, total: tiles.length }
}
