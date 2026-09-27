import { latToTileY, lonToTileX, type TileCoord } from './tile-math'

// Reading ground elevation out of a raster tile.
//
// The source is Terrarium: a PNG whose red, green and blue encode one 24-bit
// height in 1/256 m steps, offset by 32768 so the range is positive.
//
// Zoom 12 is about 38 m a pixel at the equator, the resolution of the
// underlying SRTM data; more zoom only resamples it. One tile covers roughly
// 10 km, so a flying field needs one or two.
//
// Pure: no fetch, canvas or DOM. Grids arrive already decoded.

export const TERRAIN_ZOOM = 12
export const TERRAIN_TILE_PX = 256

/** The tile key a decoded grid is stored under. */
export const gridKey = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`

/** Decoded grids, `TERRAIN_TILE_PX` squared, row-major from the north-west. */
export type TerrainGrids = ReadonlyMap<string, Float32Array>

/** One pixel of a Terrarium tile, in meters above mean sea level. */
export function decodeElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

export interface LatLon {
  lat: number
  lon: number
}

/** Where a coordinate lands in the whole-world pixel grid at this zoom. */
function pixelOf(p: LatLon, z: number): { gx: number; gy: number } {
  return {
    gx: lonToTileX(p.lon, z) * TERRAIN_TILE_PX,
    gy: latToTileY(p.lat, z) * TERRAIN_TILE_PX,
  }
}

function pixelValue(grids: TerrainGrids, z: number, gx: number, gy: number): number | null {
  const span = 2 ** z * TERRAIN_TILE_PX
  // Longitude wraps so a mission at the antimeridian reads the tiles on both
  // sides; latitude clamps.
  const x = ((gx % span) + span) % span
  const y = Math.min(span - 1, Math.max(0, gy))
  const tx = Math.floor(x / TERRAIN_TILE_PX)
  const ty = Math.floor(y / TERRAIN_TILE_PX)
  const grid = grids.get(`${z}/${tx}/${ty}`)
  if (!grid) return null
  const ix = x - tx * TERRAIN_TILE_PX
  const iy = y - ty * TERRAIN_TILE_PX
  return grid[iy * TERRAIN_TILE_PX + ix] ?? null
}

/**
 * Ground elevation at a coordinate, bilinearly interpolated so a slope does
 * not become a staircase of 38 m steps. A missing neighbor (at the edge of
 * the downloaded tiles) falls back to the pixel the coordinate is in.
 */
export function sampleElevation(grids: TerrainGrids, p: LatLon, z = TERRAIN_ZOOM): number | null {
  const { gx, gy } = pixelOf(p, z)
  // Pixel centers sit half a pixel in from the tile edge.
  const fx = gx - 0.5
  const fy = gy - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const center = pixelValue(grids, z, Math.floor(gx), Math.floor(gy))
  if (center === null) return null
  const at = (x: number, y: number) => pixelValue(grids, z, x, y) ?? center
  const tx = fx - x0
  const ty = fy - y0
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
  return top * (1 - ty) + bottom * ty
}

/** Every tile `sampleElevation` could read for these coordinates. */
export function terrainTilesFor(points: readonly LatLon[], z = TERRAIN_ZOOM): TileCoord[] {
  const seen = new Set<string>()
  const out: TileCoord[] = []
  const span = 2 ** z
  for (const p of points) {
    const { gx, gy } = pixelOf(p, z)
    // The four pixels the interpolation can touch, which may straddle a
    // tile boundary in either direction.
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const x = Math.floor((gx + dx) / TERRAIN_TILE_PX)
        const y = Math.floor((gy + dy) / TERRAIN_TILE_PX)
        if (y < 0 || y >= span) continue
        const wrapped = ((x % span) + span) % span
        const key = `${z}/${wrapped}/${y}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ z, x: wrapped, y })
      }
    }
  }
  return out
}

/**
 * Clamp elevation at sea level. Terrarium carries bathymetry, so offshore it
 * reports the sea floor. Land below sea level (Death Valley, the Dead Sea)
 * cannot be told apart from ocean in the data, so it is clamped too, which
 * overstates the ground and errs toward warning.
 */
export function groundLevel(elevationM: number): number {
  return Math.max(0, elevationM)
}
