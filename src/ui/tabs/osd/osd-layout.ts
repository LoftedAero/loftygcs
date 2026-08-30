// Pure layout logic for the OSD screen editor: grid geometry, parameter
// naming, and collision detection. No React and no store access, so the rules
// that are easy to get wrong are the ones that are easy to test.

import type { ParamMeta } from '../../../services/param-metadata'
import { OSD_ITEMS, itemExtent, type OsdItem } from './osd-items'

/** ArduPilot exposes four layout screens; OSD5/OSD6 are the on-OSD parameter
 *  editors, a different feature entirely and not laid out here. */
export const OSD_SCREENS = [1, 2, 3, 4] as const

export interface Grid {
  cols: number
  rows: number
  /** How the size was decided, shown to the user so it is not a mystery. */
  label: string
}

/** OSD{n}_TXT_RES values, and the grid each one selects. */
export const TEXT_RESOLUTIONS: readonly { value: number; grid: Grid }[] = [
  { value: 0, grid: { cols: 30, rows: 16, label: 'SD 30×16' } },
  { value: 1, grid: { cols: 50, rows: 18, label: 'HD 50×18' } },
  { value: 2, grid: { cols: 60, rows: 22, label: 'HD 60×22' } },
]

const SD: Grid = TEXT_RESOLUTIONS[0]!.grid

/** OSD_TYPE value for MSP DisplayPort -- the only backend that draws HD. */
export const TYPE_MSP_DISPLAYPORT = 5

/**
 * The character grid for a screen.
 *
 * Only MSP DisplayPort has a selectable text resolution; every other backend
 * (MAX7456, SITL, plain MSP, TXONLY) draws the classic 30x16 analog grid, and
 * OSD{n}_TXT_RES is ignored on those -- so a stale HD value left in the
 * parameters must not widen the grid. NTSC actually shows 13 visible rows
 * rather than 16, but the parameters accept 16 and ArduPilot lays out against
 * 16, so the grid stays 16 and the editor marks the rows NTSC will cut.
 */
export function screenGrid(osdType: number | undefined, txtRes: number | undefined): Grid {
  if (osdType !== TYPE_MSP_DISPLAYPORT) return SD
  return TEXT_RESOLUTIONS.find((r) => r.value === txtRes)?.grid ?? SD
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
 * parameters the connected firmware does not have are dropped, so a build
 * without, say, the RC link panels simply shows fewer items.
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
 * The firmware's declared range wins where it is tighter than the grid --
 * ArduPilot widened every panel to the HD range except RPM, which still caps
 * at 29x15, and a write past a parameter's range is rejected rather than
 * clamped. Where metadata is missing (offline, unmatched version) the grid is
 * the only bound available.
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
 * Ids of enabled panels that do not fit on the grid.
 *
 * Switching a screen from HD back to SD is the way this happens: a panel
 * parked at column 45 is perfectly legal on a 60-column screen and simply
 * never drawn on a 30-column one. The parameter keeps its value, so nothing
 * complains -- the panel just silently stops appearing.
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
 * Ids of enabled panels whose cells overlap another enabled panel.
 *
 * Overlap is the characteristic OSD mistake and it is invisible until the
 * vehicle is in the air, so the editor flags it rather than waiting for the
 * video feed to show it.
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
