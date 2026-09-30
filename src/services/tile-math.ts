// Which tiles cover a piece of the world.
//
// Web Mercator (EPSG:3857), the scheme every slippy map uses: at zoom z the
// world is a 2^z square of 256 px tiles, x running west to east and y north
// to south. Latitude maps through the Gudermannian, not linearly.

export interface TileCoord {
  z: number
  x: number
  y: number
}

export interface LatLonBounds {
  north: number
  south: number
  east: number
  west: number
}

/** Web Mercator cannot represent the poles; every map clamps here. */
export const MAX_LAT = 85.05112878

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

export function latToTileY(lat: number, z: number): number {
  const clamped = Math.min(MAX_LAT, Math.max(-MAX_LAT, lat))
  const rad = (clamped * Math.PI) / 180
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
}

/**
 * Every tile covering the bounds, across a zoom range. Counts grow fourfold
 * per zoom level, so callers should check `countTiles` first.
 */
export function tilesForBounds(
  bounds: LatLonBounds,
  minZoom: number,
  maxZoom: number,
): TileCoord[] {
  const out: TileCoord[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z - 1
    // North is a smaller y than south, so the two swap on the way in.
    const x0 = Math.max(0, Math.floor(lonToTileX(bounds.west, z)))
    const x1 = Math.min(max, Math.floor(lonToTileX(bounds.east, z)))
    const y0 = Math.max(0, Math.floor(latToTileY(bounds.north, z)))
    const y1 = Math.min(max, Math.floor(latToTileY(bounds.south, z)))
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) out.push({ z, x, y })
    }
  }
  return out
}

/**
 * The tiles an offline download fetches for a view shown at `zoom`: the view
 * itself from that level to `maxZoom`, and `outLevels` levels below it, each
 * covering a screen the size of the view, centered on it. So
 * zooming out over the field offline still fills the screen, where the view's
 * own bounds would give a single tile at the lowest level.
 */
export function offlineTiles(
  bounds: LatLonBounds,
  zoom: number,
  maxZoom: number,
  outLevels: number,
): TileCoord[] {
  const top = Math.min(Math.floor(zoom), maxZoom)
  const out = tilesForBounds(bounds, top, maxZoom)
  // The view's extent in tiles at its own level, which is the same on screen
  // at every level; each lower level covers that extent around the center.
  const width = lonToTileX(bounds.east, top) - lonToTileX(bounds.west, top)
  const height = latToTileY(bounds.south, top) - latToTileY(bounds.north, top)
  const centerLon = (bounds.east + bounds.west) / 2
  const centerLat = (bounds.north + bounds.south) / 2
  for (let z = Math.max(1, top - outLevels); z < top; z++) {
    const max = 2 ** z - 1
    const cx = lonToTileX(centerLon, z)
    const cy = latToTileY(centerLat, z)
    const x0 = Math.max(0, Math.floor(cx - width / 2))
    const x1 = Math.min(max, Math.floor(cx + width / 2))
    const y0 = Math.max(0, Math.floor(cy - height / 2))
    const y1 = Math.min(max, Math.floor(cy + height / 2))
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) out.push({ z, x, y })
    }
  }
  return out
}

/** How many tiles that would be, without building the list. */
export function countTiles(bounds: LatLonBounds, minZoom: number, maxZoom: number): number {
  let total = 0
  for (let z = minZoom; z <= maxZoom; z++) {
    const max = 2 ** z - 1
    const x0 = Math.max(0, Math.floor(lonToTileX(bounds.west, z)))
    const x1 = Math.min(max, Math.floor(lonToTileX(bounds.east, z)))
    const y0 = Math.max(0, Math.floor(latToTileY(bounds.north, z)))
    const y1 = Math.min(max, Math.floor(latToTileY(bounds.south, z)))
    total += (x1 - x0 + 1) * (y1 - y0 + 1)
  }
  return total
}

/**
 * A rough size per tile, used only to warn before a long download. Satellite
 * tiles run 15-25 KB of JPEG.
 */
export const BYTES_PER_TILE = 20_000

/** Bytes as something to read: "48 MB", "920 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** The URL for one tile, filling a Leaflet-style template. */
export function tileUrl(template: string, t: TileCoord): string {
  return template
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y))
}
