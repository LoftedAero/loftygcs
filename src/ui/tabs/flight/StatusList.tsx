import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldRegistry } from '../../../services/telemetry-fields'
import { fixed } from '../../../units'

// Every telemetry field the vehicle is sending, with its live value, as a
// filterable list. Where there is a plot, clicking a row toggles it there;
// without one the rows are read-only.

/** 4 Hz. */
const REFRESH_MS = 250

export interface StatusListProps {
  /** Fields currently plotted, so the list can show which are on. */
  plotted?: readonly string[]
  /** Omitted where there is no plot. */
  onTogglePlot?: (name: string) => void
}

export default function StatusList({ plotted = [], onTogglePlot }: StatusListProps) {
  const [filter, setFilter] = useState('')
  const [, tick] = useState(0)
  const version = useRef(-1)
  const namesRef = useRef<string[]>([])
  const rowsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Fields fill down each column then across, so the pane scrolls sideways;
  // map the vertical wheel to horizontal scroll. Registered directly because
  // React's wheel listener is passive and cannot preventDefault.
  useEffect(() => {
    const el = rowsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Sideways already (a tilt or a trackpad), or nothing to scroll.
      if (e.deltaX !== 0 || e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      // Firefox reports in lines; a line of a column is a row's height.
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 21 : e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Rebuilt only when a new field appears, not on every refresh.
  if (version.current !== fieldRegistry.version()) {
    version.current = fieldRegistry.version()
    namesRef.current = fieldRegistry.names()
  }

  const needle = filter.trim().toLowerCase()
  const shown = useMemo(
    () =>
      needle ? namesRef.current.filter((n) => n.toLowerCase().includes(needle)) : namesRef.current,
    // namesRef is a ref; the version check above drives recomputation.
    [needle, version.current],
  )

  const plottedSet = new Set(plotted)

  const hasFields = namesRef.current.length > 0

  return (
    <div className="status-list">
      {/* Hidden until there are fields to filter. Keyed on the field count
          rather than the link, so the filter and the placeholder never
          show together. */}
      {hasFields && (
        <input
          className="la-input status-list__filter"
          type="search"
          placeholder={`Filter ${namesRef.current.length} fields`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter telemetry fields"
        />
      )}
      {!hasFields && <p className="app-placeholder">Waiting for telemetry…</p>}
      {needle && shown.length === 0 && (
        <p className="app-placeholder">No field matches “{filter}”.</p>
      )}
      {/* Messages stay outside the grid, which would squeeze them into one
          column cell. */}
      <div className="status-list__rows" ref={rowsRef}>
        {shown.map((name) => {
          const v = fieldRegistry.latest(name)
          // The message prefix repeats down a column, so it is dimmed and the
          // field name carries the weight.
          const cells = (
            <>
              <span className="status-row__name" title={name}>
                <span className="status-row__msg">{prefixOf(name)}</span>
                {leafOf(name)}
              </span>
              <span className="status-row__value">{format(v)}</span>
            </>
          )
          if (!onTogglePlot) {
            return (
              <div key={name} className="status-row status-row--static">
                {cells}
              </div>
            )
          }
          const on = plottedSet.has(name)
          return (
            <button
              key={name}
              type="button"
              className={`status-row${on ? ' is-plotted' : ''}`}
              onClick={() => onTogglePlot(name)}
              title={on ? 'Remove from the plot' : 'Add to the plot'}
            >
              {cells}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** `GLOBAL_POSITION_INT.` from `GLOBAL_POSITION_INT.relativeAlt`. */
function prefixOf(name: string): string {
  const dot = name.indexOf('.')
  return dot > 0 ? name.slice(0, dot + 1) : ''
}

function leafOf(name: string): string {
  const dot = name.indexOf('.')
  return dot > 0 ? name.slice(dot + 1) : name
}

/** Fewer decimals as the magnitude grows, to keep the column readable. */
function format(v: number | undefined): string {
  if (v === undefined) return '—'
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1000) return fixed(v, 0)
  if (abs >= 1) return fixed(v, 2)
  return fixed(v, 4)
}
