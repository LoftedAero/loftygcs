import { describe, expect, it } from 'vitest'
import {
  clamp,
  clampPlacement,
  coordLimit,
  findOverlaps,
  paramName,
  readPlacements,
  screenGrid,
  type Placement,
} from './osd-layout'
import { OSD_ITEMS, itemExtent, type OsdItem } from './osd-items'

const item = (id: string): OsdItem => {
  const found = OSD_ITEMS.find((i) => i.id === id)
  if (!found) throw new Error(`no such OSD item: ${id}`)
  return found
}

const entries = (values: Record<string, number>) =>
  new Map(Object.entries(values).map(([k, v]) => [k, { value: v }]))

describe('screenGrid', () => {
  it('gives every non-DisplayPort backend the classic analog grid', () => {
    // MAX7456, SITL, plain MSP and TXONLY all ignore TXT_RES, so a stale
    // HD setting left over from a DisplayPort build must not widen the grid.
    for (const type of [0, 1, 2, 3, 4]) {
      expect(screenGrid(type, 2)).toMatchObject({ cols: 30, rows: 16 })
    }
  })

  it('honors the text resolution on MSP DisplayPort', () => {
    expect(screenGrid(5, 0)).toMatchObject({ cols: 30, rows: 16 })
    expect(screenGrid(5, 1)).toMatchObject({ cols: 50, rows: 18 })
    expect(screenGrid(5, 2)).toMatchObject({ cols: 60, rows: 22 })
  })

  it('falls back to the analog grid when the resolution is unreadable', () => {
    expect(screenGrid(5, undefined)).toMatchObject({ cols: 30, rows: 16 })
  })
})

describe('readPlacements', () => {
  it('reads position and enable state per screen', () => {
    const table = entries({
      OSD1_ALTITUDE_EN: 1,
      OSD1_ALTITUDE_X: 4,
      OSD1_ALTITUDE_Y: 2,
      OSD2_ALTITUDE_EN: 0,
      OSD2_ALTITUDE_X: 9,
      OSD2_ALTITUDE_Y: 9,
    })
    const items = [item('ALTITUDE')]
    expect(readPlacements(table, 1, items)).toEqual([
      { item: item('ALTITUDE'), x: 4, y: 2, enabled: true },
    ])
    expect(readPlacements(table, 2, items)).toEqual([
      { item: item('ALTITUDE'), x: 9, y: 9, enabled: false },
    ])
  })

  it('drops panels the firmware does not expose', () => {
    // A build without the RC link panels should simply show fewer items
    // rather than rendering controls that write nonexistent parameters.
    const table = entries({ OSD1_ALTITUDE_EN: 1, OSD1_ALTITUDE_X: 0, OSD1_ALTITUDE_Y: 0 })
    const got = readPlacements(table, 1, [item('ALTITUDE'), item('RC_LQ')])
    expect(got.map((p) => p.item.id)).toEqual(['ALTITUDE'])
  })

  it('needs all three parameters before it will place a panel', () => {
    const table = entries({ OSD1_ALTITUDE_EN: 1, OSD1_ALTITUDE_X: 0 })
    expect(readPlacements(table, 1, [item('ALTITUDE')])).toEqual([])
  })
})

describe('coordLimit', () => {
  const grid = screenGrid(5, 2) // 60x22

  it('uses the grid when metadata is unavailable', () => {
    expect(coordLimit({}, 1, item('ALTITUDE'), 'X', grid)).toBe(59)
    expect(coordLimit({}, 1, item('ALTITUDE'), 'Y', grid)).toBe(21)
  })

  it("respects a parameter's own range where it is tighter than the grid", () => {
    // ArduPilot widened every panel to the HD range except RPM, which still
    // caps at 29x15. A write past a parameter's range is rejected outright,
    // so the editor must not let one be dragged there.
    const metadata = {
      OSD1_RPM_X: { range: { low: 0, high: 29 } },
      OSD1_RPM_Y: { range: { low: 0, high: 15 } },
    }
    expect(coordLimit(metadata, 1, item('RPM'), 'X', grid)).toBe(29)
    expect(coordLimit(metadata, 1, item('RPM'), 'Y', grid)).toBe(15)
  })

  it('never lets metadata push a coordinate off the grid', () => {
    const metadata = { OSD1_ALTITUDE_X: { range: { low: 0, high: 59 } } }
    const sd = screenGrid(1, 0) // 30x16
    expect(coordLimit(metadata, 1, item('ALTITUDE'), 'X', sd)).toBe(29)
  })
})

describe('clampPlacement', () => {
  const grid = screenGrid(1, 0) // 30x16

  it('keeps a panel wholly on screen, allowing for its width', () => {
    const alt = item('ALTITUDE') // sample "123M" -> 4 cells wide
    expect(itemExtent(alt).width).toBe(4)
    expect(clampPlacement(alt, 99, 99, grid, {}, 1)).toEqual({ x: 26, y: 15 })
  })

  it('accounts for the height of a graphic panel', () => {
    const horizon = item('HORIZON') // 17x7
    expect(clampPlacement(horizon, 99, 99, grid, {}, 1)).toEqual({ x: 13, y: 9 })
  })

  it('refuses negative positions and snaps to whole cells', () => {
    expect(clampPlacement(item('ALTITUDE'), -5, -5, grid, {}, 1)).toEqual({ x: 0, y: 0 })
    expect(clampPlacement(item('ALTITUDE'), 3.6, 2.2, grid, {}, 1)).toEqual({ x: 4, y: 2 })
  })

  it('collapses to zero rather than going negative for an oversize panel', () => {
    // SIDEBARS is 23 wide; on a 30-column grid that still fits, but the
    // clamp must not produce a negative limit if a panel ever exceeds it.
    const wide: OsdItem = { id: 'X', label: 'x', sample: '', group: 'flight', width: 40 }
    expect(clampPlacement(wide, 5, 0, grid, {}, 1).x).toBe(0)
  })
})

describe('findOverlaps', () => {
  const place = (id: string, x: number, y: number, enabled = true): Placement => ({
    item: item(id),
    x,
    y,
    enabled,
  })

  it('finds panels sharing a cell', () => {
    // ALTITUDE is 4 wide at column 0, so columns 0-3; BAT_VOLT starting at
    // column 3 collides on that last one.
    const hit = findOverlaps([place('ALTITUDE', 0, 0), place('BAT_VOLT', 3, 0)])
    expect([...hit].sort()).toEqual(['ALTITUDE', 'BAT_VOLT'])
  })

  it('leaves adjacent panels alone', () => {
    expect(findOverlaps([place('ALTITUDE', 0, 0), place('BAT_VOLT', 4, 0)]).size).toBe(0)
  })

  it('ignores disabled panels', () => {
    // A panel that is off draws nothing, so a stale position underneath a
    // live one is not a fault worth flagging.
    expect(findOverlaps([place('ALTITUDE', 0, 0), place('BAT_VOLT', 0, 0, false)]).size).toBe(0)
  })

  it('detects overlap across the rows of a multi-row panel', () => {
    const hit = findOverlaps([place('HORIZON', 0, 0), place('ALTITUDE', 2, 5)])
    expect([...hit].sort()).toEqual(['ALTITUDE', 'HORIZON'])
  })
})

describe('paramName and clamp', () => {
  it('builds the firmware parameter names', () => {
    expect(paramName(3, 'BAT_VOLT', 'EN')).toBe('OSD3_BAT_VOLT_EN')
    expect(paramName(1, 'ALTITUDE', 'X')).toBe('OSD1_ALTITUDE_X')
  })

  it('clamps to the closed interval', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })
})

describe('the item catalog', () => {
  it('has no duplicate ids', () => {
    const ids = OSD_ITEMS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every graphic panel an explicit footprint', () => {
    // A panel with no sample text would otherwise collapse to one cell and
    // silently under-report the space it occupies.
    for (const i of OSD_ITEMS) {
      if (i.sample === '') expect(i.width, `${i.id} needs a width`).toBeGreaterThan(0)
    }
  })

  it('fits every panel on the smallest grid it can be placed on', () => {
    // Nothing in the catalog may be wider than the analog screen, or it
    // could never be positioned at all.
    for (const i of OSD_ITEMS) {
      const extent = itemExtent(i)
      expect(extent.width, `${i.id} is too wide for 30 columns`).toBeLessThanOrEqual(30)
      expect(extent.height, `${i.id} is too tall for 16 rows`).toBeLessThanOrEqual(16)
    }
  })
})
