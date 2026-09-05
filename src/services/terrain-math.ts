import { latToTileY, lonToTileX, type TileCoord } from './tile-math'

// Reading ground elevation out of a raster tile.
//
// The source is the Terrarium scheme: an ordinary PNG where each pixel's
// red, green and blue encode one 24-bit height in centimeter-ish steps,
// offset so the whole range is positive. Every value is fixed by the
// format, not chosen here -- 256, 1/256 and 32768 are the encoding.
//
// Terrarium at zoom 12 is about 38 m a pixel at the equator, which is the
// resolution of the underlying SRTM data; asking for more zoom resamples
// the same measurements into more pixels and downloads sixteen times as
// much to do it. One tile covers roughly 10 km, so a flying field is one
// or two tiles -- which is why terrain rides the same offline cache as the
// map without meaningfully adding to a download.
//
// Pure: no fetch, no canvas, no DOM. The grids arrive already decoded.

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
  // Longitude wraps, latitude does not: a mission at the antimeridian is
  // rare but reads the tiles on both sides of it, and clamping there would
  // silently sample the wrong side of the world.
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
 * Ground elevation at a coordinate, bilinearly interpolated.
 *
 * Nearest-pixel sampling puts 38 m steps in a terrain profile, which reads
 * as a staircase of cliffs on ground that is actually a slope -- and the
 * whole point of the profile is judging whether a leg clears the ground.
 * A neighbor that is missing (the sample sits at the edge of what was
 * downloaded) falls back to the pixel the coordinate is actually in rather
 * than refusing to answer.
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
 * Sea level, for ground that reads below it.
 *
 * Terrarium carries bathymetry, so an offshore leg reports the sea floor --
 * four kilometers down in the Pacific, which would draw a profile with the
 * flight path apparently clearing everything by a mile and squash the
 * scale of the part anyone cares about. Land genuinely below sea level
 * (Death Valley, the Dead Sea) is indistinguishable from ocean in the data,
 * so both are pulled up to zero: over water that is the surface, and over
 * a depression it overstates the ground, which errs toward warning.
 */
export function groundLevel(elevationM: number): number {
  return Math.max(0, elevationM)
}
