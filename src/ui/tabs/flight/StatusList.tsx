import { useEffect, useMemo, useRef, useState } from 'react'
import { fieldRegistry } from '../../../services/telemetry-fields'

// Every telemetry field the vehicle is sending, with its live value.
//
// Mission Planner's equivalent is a grid of several hundred checkboxes you
// hunt through; this is a filtered list instead, because the only way anyone
// finds a field in a list that long is by typing part of its name. Rows are
// clickable so a field can go straight onto a plot from here, which saves
// finding it twice.

/** Four times a second: fast enough to read, slow enough to cost nothing. */
const REFRESH_MS = 250

export interface StatusListProps {
  /** Fields currently plotted, so the list can show which are on. */
  plotted: readonly string[]
  onTogglePlot: (name: string) => void
}

export default function StatusList({ plotted, onTogglePlot }: StatusListProps) {
  const [filter, setFilter] = useState('')
  const [, tick] = useState(0)
  const version = useRef(-1)
  const namesRef = useRef<string[]>([])

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // The name list only changes when a field is seen for the first time, so
  // it is rebuilt on that rather than on every refresh.
  if (version.current !== fieldRegistry.version()) {
    version.current = fieldRegistry.version()
    namesRef.current = fieldRegistry.names()
  }

  const needle = filter.trim().toLowerCase()
  const shown = useMemo(
    () =>
      needle
        ? namesRef.current.filter((n) => n.toLowerCase().includes(needle))
        : namesRef.current,
    // namesRef is deliberately not a dependency: it is a ref, and the
    // version check above is what makes this recompute.
    [needle, version.current],
  )

  const plottedSet = new Set(plotted)

  return (
    <div className="status-list">
      <input
        className="la-input status-list__filter"
        type="search"
        placeholder={`Filter ${namesRef.current.length} fields…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter telemetry fields"
      />
      <div className="status-list__rows">
        {namesRef.current.length === 0 && (
          <p className="app-placeholder">Waiting for telemetry…</p>
        )}
        {shown.map((name) => {
          const v = fieldRegistry.latest(name)
          const on = plottedSet.has(name)
          return (
            <button
              key={name}
              type="button"
              className={`status-row${on ? ' is-plotted' : ''}`}
              onClick={() => onTogglePlot(name)}
              title={on ? 'Remove from the plot' : 'Add to the plot'}
            >
              <span className="status-row__name">{name}</span>
              <span className="status-row__value">{format(v)}</span>
            </button>
          )
        })}
        {needle && shown.length === 0 && (
          <p className="app-placeholder">No field matches “{filter}”.</p>
        )}
      </div>
    </div>
  )
}

/** Enough digits to be useful, few enough that the column stays readable. */
function format(v: number | undefined): string {
  if (v === undefined) return '—'
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toFixed(0)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(4)
}
