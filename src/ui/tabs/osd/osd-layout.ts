// Pure layout logic for the OSD screen editor: grid geometry, parameter
// naming, and collision detection. No React or store access, for testing.

import type { ParamMeta } from '../../../services/param-metadata'
import { OSD_ITEMS, itemExtent, type OsdItem } from './osd-items'

/** ArduPilot exposes four layout screens; OSD5/OSD6 are parameter-editor
 *  screens, not laid out here. */
export const OSD_SCREENS = [1, 2, 3, 4] as const

export interface Grid {
  cols: number
  rows: number
  /** How the size was decided, shown to the user. */
  label: string
}

/** OSD{n}_TXT_RES values, and the grid each one selects. */
export const TEXT_RESOLUTIONS: readonly { value: number; grid: Grid }[] = [
  { value: 0, grid: { cols: 30, rows: 16, label: 'SD 30×16' } },
  { value: 1, grid: { cols: 50, rows: 18, label: 'HD 50×18' } },
  { value: 2, grid: { cols: 60, rows: 22, label: 'HD 60×22' } },
]

const SD: Grid = TEXT_RESOLUTIONS[0]!.grid

/** OSD_TYPE value for MSP DisplayPort, the only backend that draws HD. */
export const TYPE_MSP_DISPLAYPORT = 5

/**
 * The character grid for a screen.
 *
 * Only MSP DisplayPort has a selectable text resolution; every other backend
 * (MAX7456, SITL, plain MSP, TXONLY) draws the 30x16 analog grid and ignores
 * OSD{n}_TXT_RES. NTSC shows only 13 rows, but ArduPilot lays out against 16,
 * so the grid stays 16 and the editor marks the rows NTSC cuts.
 */
export function screenGrid(osdType: number | undefined, txtRes: number | undefined): Grid {
  if (osdType !== TYPE_MSP_DISPLAYPORT) return SD
  return TEXT_RESOLUTIONS.find((r) => r.value === txtRes)?.grid ?? SD
}

/**
 * The canvas DJI O3 and Walksnail goggles draw. OSD{n}_TXT_RES has no value
 * for it, but layouts made for those goggles use it.
 */
const HD_53X20: Grid = { cols: 53, rows: 20, label: 'HD 53×20' }

/** Every canvas a video system draws, smallest first. */
const CANVASES: readonly Grid[] = [
  SD,
  TEXT_RESOLUTIONS[1]!.grid,
  HD_53X20,
  TEXT_RESOLUTIONS[2]!.grid,
]

/**
 * The grid the editor draws, and the one the screen declares.
 *
 * Over MSP DisplayPort ArduPilot does not clip to OSD{n}_TXT_RES: it writes
 * each panel at its stored column and row, and the goggles draw what lands on
 * their own canvas, whose size the vehicle never learns. A layout that works
 * can therefore sit outside the declared grid (a 53x20 layout with TXT_RES
 * left at 0). The panels are the evidence, so the editor draws the smallest
 * canvas that holds every enabled one, never smaller than the declared grid.
 * Other backends draw exactly their grid.
 */
export function editorGrid(
  osdType: number | undefined,
  txtRes: number | undefined,
  placements: readonly Placement[],
): { grid: Grid; declared: Grid } {
  const declared = screenGrid(osdType, txtRes)
  if (osdType !== TYPE_MSP_DISPLAYPORT) return { grid: declared, declared }
  const holds = CANVASES.filter((c) => c.cols >= declared.cols && c.rows >= declared.rows)
  const grid =
    holds.find((c) => findOffGrid(placements, c).size === 0) ?? holds[holds.length - 1] ?? declared
  return { grid, declared }
}

/** Rows beyond an NTSC frame's 13 visible lines, on the classic analog grid. */
export const NTSC_VISIBLE_ROWS = 13

export function paramName(screen: number, id: string, suffix: 'EN' | 'X' | 'Y'): string {
  return `OSD${screen}_${id}_${suffix}`
}

export interface Placement {
  item: OsdItem
  x: number
  y: number
  enabled: boolean
}

/**
 * Read one screen's placements out of the parameter table. Items whose
 * parameters the connected firmware lacks are dropped.
 */
export function readPlacements(
  entries: Map<string, { value: number }>,
  screen: number,
  items: readonly OsdItem[] = OSD_ITEMS,
): Placement[] {
  const out: Placement[] = []
  for (const item of items) {
    const en = entries.get(paramName(screen, item.id, 'EN'))
    const x = entries.get(paramName(screen, item.id, 'X'))
    const y = entries.get(paramName(screen, item.id, 'Y'))
    if (!en || !x || !y) continue
    out.push({ item, x: x.value, y: y.value, enabled: en.value !== 0 })
  }
  return out
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Highest legal value for one coordinate.
 *
 * The parameter's declared range wins where it is tighter than the grid
 * (RPM caps at 29x15), since a write past it is rejected rather than
 * clamped. Without metadata the grid is the only bound.
 */
export function coordLimit(
  metadata: Record<string, ParamMeta>,
  screen: number,
  item: OsdItem,
  axis: 'X' | 'Y',
  grid: Grid,
): number {
  const gridMax = (axis === 'X' ? grid.cols : grid.rows) - 1
  const declared = metadata[paramName(screen, item.id, axis)]?.range?.high
  return declared === undefined ? gridMax : Math.min(gridMax, declared)
}

/** Clamp a proposed position so the panel stays on screen and in range. */
export function clampPlacement(
  item: OsdItem,
  x: number,
  y: number,
  grid: Grid,
  metadata: Record<string, ParamMeta>,
  screen: number,
): { x: number; y: number } {
  const extent = itemExtent(item)
  // A panel may not hang off the right or bottom edge, so its own width
  // tightens the limit further than the coordinate range does.
  const maxX = Math.min(coordLimit(metadata, screen, item, 'X', grid), grid.cols - extent.width)
  const maxY = Math.min(coordLimit(metadata, screen, item, 'Y', grid), grid.rows - extent.height)
  return {
    x: clamp(Math.round(x), 0, Math.max(0, maxX)),
    y: clamp(Math.round(y), 0, Math.max(0, maxY)),
  }
}

/**
 * Ids of enabled panels that do not fit on the grid. On an analog OSD such a
 * panel silently stops appearing.
 */
export function findOffGrid(placements: readonly Placement[], grid: Grid): Set<string> {
  const out = new Set<string>()
  for (const p of placements) {
    if (!p.enabled) continue
    const extent = itemExtent(p.item)
    if (p.x + extent.width > grid.cols || p.y + extent.height > grid.rows) out.add(p.item.id)
  }
  return out
}

/**
 * Ids of enabled panels whose cells overlap another enabled panel, which is
 * otherwise invisible until the vehicle is flying.
 */
export function findOverlaps(placements: readonly Placement[]): Set<string> {
  const live = placements.filter((p) => p.enabled)
  const hit = new Set<string>()
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      if (!a || !b) continue
      const ea = itemExtent(a.item)
      const eb = itemExtent(b.item)
      const apart =
        a.x + ea.width <= b.x ||
        b.x + eb.width <= a.x ||
        a.y + ea.height <= b.y ||
        b.y + eb.height <= a.y
      if (!apart) {
        hit.add(a.item.id)
        hit.add(b.item.id)
      }
    }
  }
  return hit
}
