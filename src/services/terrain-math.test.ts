import { describe, expect, it } from 'vitest'
import {
  decodeElevation,
  groundLevel,
  sampleElevation,
  TERRAIN_TILE_PX,
  terrainTilesFor,
} from './terrain-math'
import { MAX_AREA_TERRAIN_TILES, terrainTilesForArea } from './terrain'

// The decoder is checked against elevations pushed back through the encoder.
// For reference, live tiles read CMAC at 585 m (surveyed 584) and Badwater at
// -80 (surveyed -85).

const encode = (m: number) => {
  const v = Math.round((m + 32768) * 256)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff] as const
}

/** A one-tile world at zoom 0, so a lat/lon maps to a known pixel. */
const lonForPixel = (gx: number) => (gx / TERRAIN_TILE_PX) * 360 - 180

function rampTile(value: (ix: number, iy: number) => number) {
  const grid = new Float32Array(TERRAIN_TILE_PX * TERRAIN_TILE_PX)
  for (let iy = 0; iy < TERRAIN_TILE_PX; iy++)
    for (let ix = 0; ix < TERRAIN_TILE_PX; ix++) grid[iy * TERRAIN_TILE_PX + ix] = value(ix, iy)
  return new Map([['0/0/0', grid]])
}

describe('the elevation encoding', () => {
  it('round-trips heights a flight would meet', () => {
    for (const m of [0, 1, 219, 584, 1596, 8728, -80]) {
      expect(decodeElevation(...encode(m))).toBeCloseTo(m, 2)
    }
  })

  it('places the zero offset where the format puts it', () => {
    expect(decodeElevation(0, 0, 0)).toBe(-32768)
    expect(decodeElevation(128, 0, 0)).toBe(0)
    // The blue channel is the fractional part: a whole meter is one green.
    expect(decodeElevation(128, 1, 0)).toBe(1)
    expect(decodeElevation(128, 0, 128)).toBeCloseTo(0.5, 6)
  })
})

describe('sampling the grid', () => {
  const grids = rampTile((ix) => ix)

  it('interpolates between pixels rather than stepping', () => {
    // Nearest-pixel sampling would answer 129 here, turning slopes into steps.
    expect(sampleElevation(grids, { lat: 0, lon: lonForPixel(129) }, 0)).toBeCloseTo(128.5, 4)
    expect(sampleElevation(grids, { lat: 0, lon: lonForPixel(128.5) }, 0)).toBeCloseTo(128, 4)
    expect(sampleElevation(grids, { lat: 0, lon: lonForPixel(128.75) }, 0)).toBeCloseTo(128.25, 4)
  })

  it('follows a slope monotonically across the tile', () => {
    let prev = -Infinity
    for (let gx = 20; gx < 200; gx += 7) {
      const v = sampleElevation(grids, { lat: 0, lon: lonForPixel(gx) }, 0)!
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })

  it('answers null where nothing has been downloaded', () => {
    expect(sampleElevation(new Map(), { lat: 0, lon: 0 }, 0)).toBeNull()
  })

  it('still answers at the edge of what was downloaded', () => {
    // The neighbor pixel needed for interpolation is off the tile, so the
    // point's own pixel is used.
    const v = sampleElevation(rampTile(() => 42), { lat: 84.9, lon: -179.99 }, 0)
    expect(v).toBeCloseTo(42, 4)
  })
})

describe('which tiles are needed', () => {
  it('is one tile for a point well inside one', () => {
    expect(terrainTilesFor([{ lat: 40.1236, lon: -88.8286 }], 12)).toHaveLength(1)
  })

  it('is four where a point sits on a tile corner', () => {
    // The corner of tile 12/1171/1566: interpolation reads all four.
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * 1566) / 2 ** 12))) * 180) / Math.PI
    const lon = (1171 / 2 ** 12) * 360 - 180
    const tiles = terrainTilesFor([{ lat, lon }], 12)
    expect(tiles.length).toBeGreaterThanOrEqual(4)
  })

  it('wraps at the antimeridian instead of asking for tile -1', () => {
    const tiles = terrainTilesFor([{ lat: 0, lon: -179.9999 }], 8)
    expect(tiles.every((t) => t.x >= 0 && t.x < 2 ** 8)).toBe(true)
    expect(tiles.some((t) => t.x === 255)).toBe(true)
  })

  it('asks for each tile once, however many samples land on it', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      lat: 40.12 + i * 1e-5,
      lon: -88.83 + i * 1e-5,
    }))
    expect(terrainTilesFor(many, 12)).toHaveLength(1)
  })
})

describe('ground under water', () => {
  it('pulls the sea floor up to the surface', () => {
    // Terrarium carries bathymetry; a coastal leg would otherwise show
    // kilometers of imaginary clearance.
    expect(groundLevel(-4965)).toBe(0)
    expect(groundLevel(0)).toBe(0)
    expect(groundLevel(219)).toBe(219)
  })
})

describe('how much terrain an area may ask for', () => {
  it('covers a flying field in a tile or two', () => {
    const field = { north: 40.13, south: 40.11, east: -88.81, west: -88.85 }
    const tiles = terrainTilesForArea(field)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThanOrEqual(4)
  })

  it('refuses the whole world rather than trying to answer for it', () => {
    // The whole world is 341,598 tiles at this zoom (about 30 GB), and it is
    // what the map shows before anyone touches it.
    expect(terrainTilesForArea({ north: 85, south: -85, east: 180, west: -180 })).toEqual([])
  })

  it('draws the line where a trip stops being a trip', () => {
    // About 800 km on a side is still answered; a continent is not.
    const trip = { north: 40, south: 37, east: -104, west: -108 }
    expect(terrainTilesForArea(trip).length).toBeLessThanOrEqual(MAX_AREA_TERRAIN_TILES)
    const continent = { north: 50, south: 25, east: -70, west: -125 }
    expect(terrainTilesForArea(continent)).toEqual([])
  })
})
