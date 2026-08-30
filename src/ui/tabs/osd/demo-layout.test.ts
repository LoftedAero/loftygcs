import { describe, expect, it } from 'vitest'
import { OSD_PANELS } from '../../../transport/virtual-fc'
import { OSD_ITEMS, itemExtent } from './osd-items'
import { findOverlaps, screenGrid, type Placement } from './osd-layout'

// The virtual FC ships a default OSD layout, and demo mode is how this app
// gets reviewed -- so the screen it opens on has to be a valid one. These
// checks failed when first written (a nine-cell efficiency panel sat one
// column off the right edge), which is the argument for keeping them.
//
// This is the one place the UI reaches into transport: the simulated firmware
// declares its own parameters, as real firmware does, and nothing but a test
// can tell whether the two agree.

const SD = screenGrid(1, 0)

describe('the demo vehicle OSD layout', () => {
  const items = new Map(OSD_ITEMS.map((i) => [i.id, i]))

  it('only names panels the editor has in its catalog', () => {
    // A panel the catalog does not know is silently dropped, so it would
    // vanish from the demo rather than fail loudly.
    for (const [id] of OSD_PANELS) expect(items.has(id), `catalog is missing ${id}`).toBe(true)
  })

  it('places every panel wholly inside the analog screen', () => {
    for (const [id, x, y] of OSD_PANELS) {
      const item = items.get(id)
      if (!item) continue
      const extent = itemExtent(item)
      expect(x + extent.width, `${id} runs off the right edge`).toBeLessThanOrEqual(SD.cols)
      expect(y + extent.height, `${id} runs off the bottom edge`).toBeLessThanOrEqual(SD.rows)
    }
  })

  it('opens on a screen with nothing overlapping', () => {
    const placements: Placement[] = OSD_PANELS.flatMap(([id, x, y, on]) => {
      const item = items.get(id)
      return item ? [{ item, x, y, enabled: on }] : []
    })
    expect(placements.filter((p) => p.enabled).length).toBeGreaterThan(10)
    expect([...findOverlaps(placements)]).toEqual([])
  })
})
