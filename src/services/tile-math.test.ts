import { describe, expect, it } from 'vitest'
import {
  countTiles,
  formatBytes,
  latToTileY,
  lonToTileX,
  MAX_LAT,
  tileUrl,
  tilesForBounds,
} from './tile-math'

// Checked against published slippy-map values (the OSM wiki's Greenwich
// example at zoom 17) and the projection's fixed corners.

describe('the projection', () => {
  it('puts the prime meridian and the equator at the middle', () => {
    for (const z of [0, 1, 8, 17]) {
      expect(lonToTileX(0, z)).toBeCloseTo(2 ** z / 2, 9)
      expect(latToTileY(0, z)).toBeCloseTo(2 ** z / 2, 9)
    }
  })

  it('puts the antimeridian at the edges', () => {
    expect(lonToTileX(-180, 5)).toBeCloseTo(0, 9)
    expect(lonToTileX(180, 5)).toBeCloseTo(32, 9)
  })

  it('clamps at the latitude Mercator stops at', () => {
    // Beyond 85.05 the projection runs to infinity, so every map clamps.
    expect(latToTileY(MAX_LAT, 4)).toBeCloseTo(0, 6)
    expect(latToTileY(89, 4)).toBeCloseTo(latToTileY(MAX_LAT, 4), 9)
    expect(latToTileY(-89, 4)).toBeCloseTo(latToTileY(-MAX_LAT, 4), 9)
  })

  it('round-trips through the inverse projection', () => {
    // Checked against the standard inverse, atan(sinh(...)), which is
    // independent arithmetic from the forward ln(tan + sec).
    const tileYToLat = (y: number, z: number) =>
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
    const tileXToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180

    for (const z of [1, 8, 14, 19]) {
      for (const lat of [0, 12.34, -45.6, 51.4778, -35.363262, 80]) {
        expect(tileYToLat(latToTileY(lat, z), z)).toBeCloseTo(lat, 9)
      }
      for (const lon of [0, -0.0014, 149.165237, -122.4, 179.9]) {
        expect(tileXToLon(lonToTileX(lon, z), z)).toBeCloseTo(lon, 9)
      }
    }
  })

  it('is not linear in latitude, which is the whole point', () => {
    // A degree near the pole covers far fewer tiles than one at the equator.
    const nearEquator = latToTileY(1, 10) - latToTileY(0, 10)
    const nearPole = latToTileY(81, 10) - latToTileY(80, 10)
    expect(Math.abs(nearPole)).toBeGreaterThan(Math.abs(nearEquator) * 2)
  })
})

describe('covering an area', () => {
  const field = { north: -35.36, south: -35.37, east: 149.17, west: 149.16 }

  it('returns every tile once, inside the requested zooms', () => {
    const tiles = tilesForBounds(field, 14, 16)
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`))
    expect(keys.size).toBe(tiles.length)
    expect(tiles.every((t) => t.z >= 14 && t.z <= 16)).toBe(true)
    expect(tiles.some((t) => t.z === 14)).toBe(true)
    expect(tiles.some((t) => t.z === 16)).toBe(true)
  })

  it('counts without building the list, and agrees with it', () => {
    for (const [lo, hi] of [
      [10, 12],
      [14, 17],
      [18, 18],
    ] as const) {
      expect(countTiles(field, lo, hi)).toBe(tilesForBounds(field, lo, hi).length)
    }
  })

  it('grows about fourfold per zoom level', () => {
    // Why the prefetch dialog shows the tile count before starting.
    const z16 = countTiles(field, 16, 16)
    const z18 = countTiles(field, 18, 18)
    expect(z18).toBeGreaterThan(z16 * 8)
  })

  it('covers a single point with one tile per level', () => {
    const point = { north: 51.5, south: 51.5, east: -0.1, west: -0.1 }
    expect(countTiles(point, 15, 15)).toBe(1)
    expect(countTiles(point, 10, 15)).toBe(6)
  })

  it('stays inside the world at low zoom', () => {
    const whole = { north: 89, south: -89, east: 180, west: -180 }
    const tiles = tilesForBounds(whole, 0, 2)
    // 1 + 4 + 16, and nothing with a negative or out-of-range index.
    expect(tiles).toHaveLength(21)
    expect(tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x < 2 ** t.z && t.y < 2 ** t.z)).toBe(true)
  })
})

describe('presenting it', () => {
  it('fills a Leaflet-style template', () => {
    expect(tileUrl('https://x/{z}/{x}/{y}.png', { z: 5, x: 1, y: 2 })).toBe('https://x/5/1/2.png')
    // Esri numbers its imagery {z}/{y}/{x}; the template carries that, not us.
    expect(tileUrl('https://x/{z}/{y}/{x}', { z: 5, x: 1, y: 2 })).toBe('https://x/5/2/1')
  })

  it('formats sizes the way a download dialog should', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})
