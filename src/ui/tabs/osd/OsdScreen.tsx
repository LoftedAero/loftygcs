import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { itemExtent } from './osd-items'
import { NTSC_VISIBLE_ROWS, type Grid, type Placement } from './osd-layout'

// The screen preview: a character grid you drag panels around on.
//
// Built from DOM elements rather than a canvas so every panel is a focusable
// control and arrow keys can move it, not only dragging.
//
// Panels render one character per grid cell rather than relying on the
// font's advance width, so what looks like it fits does fit. It costs a span
// per character, a few hundred at worst.

export interface OsdScreenProps {
  grid: Grid
  placements: readonly Placement[]
  selectedId: string | null
  overlaps: ReadonlySet<string>
  /** Panels the current grid is too small for; clipped rather than drawn. */
  offGrid: ReadonlySet<string>
  /**
   * The OSD is off, so the layout is readable but not editable.
   */
  disabled?: boolean | undefined
  /**
   * What an empty screen says. Omitted, it points at the panel list; `null`
   * shows nothing, for when the Panels card already explains why (the OSD or
   * this screen is off).
   */
  emptyText?: string | null
  /** Highlight the rows an NTSC frame cuts off. Analog grids only. */
  showNtscGuide: boolean
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
}

const NUDGE: Record<string, { dx: number; dy: number } | undefined> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

interface DragState {
  id: string
  /** Where in the panel the pointer grabbed it, in cells. */
  grabX: number
  grabY: number
  x: number
  y: number
}

export default function OsdScreen({
  grid,
  placements,
  selectedId,
  overlaps,
  offGrid,
  showNtscGuide,
  disabled,
  emptyText = 'Nothing is on this screen. Turn panels on from the list to place them.',
  onSelect,
  onMove,
}: OsdScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // Pointer position in fractional grid cells.
  const cellAt = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: ((clientX - rect.left) / rect.width) * grid.cols,
      y: ((clientY - rect.top) / rect.height) * grid.rows,
    }
  }

  const beginDrag = (e: ReactPointerEvent<HTMLButtonElement>, p: Placement) => {
    // Primary button only, so other clicks keep their usual meanings.
    if (e.button !== 0) return
    const at = cellAt(e.clientX, e.clientY)
    if (!at) return
    e.currentTarget.setPointerCapture(e.pointerId)
    onSelect(p.item.id)
    setDrag({ id: p.item.id, grabX: at.x - p.x, grabY: at.y - p.y, x: p.x, y: p.y })
  }

  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const at = cellAt(e.clientX, e.clientY)
    if (!at) return
    setDrag({ ...drag, x: at.x - drag.grabX, y: at.y - drag.grabY })
  }

  // Only the final position is committed; each commit copies the parameter
  // map.
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    onMove(drag.id, drag.x, drag.y)
    setDrag(null)
  }

  // MAX7456 character cells are 12x18 px, so a cell is 2:3: a 30x16 screen
  // comes out 5:4 like analog video, and HD grids near 16:9. Passed to CSS as
  // a bare number so the stylesheet can derive width from a capped height
  // without squashing the grid.
  const stageStyle = {
    '--osd-cols': grid.cols,
    '--osd-rows': grid.rows,
    '--osd-aspect': (grid.cols * 2) / (grid.rows * 3),
  } as CSSProperties

  return (
    <div className="osd-screen" style={stageStyle}>
      <div className="osd-screen__stage" ref={stageRef}>
        {showNtscGuide && grid.rows > NTSC_VISIBLE_ROWS && (
          <div
            className="osd-screen__ntsc"
            style={{ top: `${(NTSC_VISIBLE_ROWS / grid.rows) * 100}%` }}
            aria-hidden="true"
          >
            <span className="osd-screen__ntsc-label">NTSC cuts here</span>
          </div>
        )}

        {/* An empty OSD screen is normal (three of the four ship that way),
            so say so rather than look like a failed render. */}
        {emptyText !== null && !placements.some((p) => p.enabled) && (
          <p className="osd-screen__empty">{emptyText}</p>
        )}

        {placements
          .filter((p) => p.enabled)
          .map((p) => {
            const live = drag?.id === p.item.id ? drag : null
            // Mid-drag the panel follows the pointer unsnapped; it snaps to a
            // cell on release.
            const x = live ? live.x : p.x
            const y = live ? live.y : p.y
            const extent = itemExtent(p.item)
            const graphic = p.item.sample === ''
            const classes = [
              'osd-panel',
              graphic ? 'osd-panel--graphic' : '',
              selectedId === p.item.id ? 'is-selected' : '',
              overlaps.has(p.item.id) ? 'is-overlapping' : '',
              offGrid.has(p.item.id) ? 'is-offgrid' : '',
              live ? 'is-dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={p.item.id}
                type="button"
                className={classes}
                style={{
                  left: `${(x / grid.cols) * 100}%`,
                  top: `${(y / grid.rows) * 100}%`,
                  width: `${(extent.width / grid.cols) * 100}%`,
                  height: `${(extent.height / grid.rows) * 100}%`,
                }}
                onPointerDown={(e) => {
                  if (disabled) return
                  beginDrag(e, p)
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => {
                  if (disabled) return
                  const step = NUDGE[e.key]
                  if (!step) return
                  // Shift moves five cells at a time.
                  const scale = e.shiftKey ? 5 : 1
                  e.preventDefault()
                  onMove(p.item.id, p.x + step.dx * scale, p.y + step.dy * scale)
                }}
                onFocus={() => onSelect(p.item.id)}
                title={`${p.item.label} — column ${p.x}, row ${p.y}`}
                aria-label={`${p.item.label}, column ${p.x}, row ${p.y}`}
              >
                {graphic ? (
                  <span className="osd-panel__graphic">{p.item.label}</span>
                ) : (
                  [...p.item.sample].map((ch, i) => (
                    <span key={i} className="osd-panel__cell">
                      {ch}
                    </span>
                  ))
                )}
              </button>
            )
          })}
      </div>
    </div>
  )
}
