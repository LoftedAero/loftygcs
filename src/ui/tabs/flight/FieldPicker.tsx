import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaModal } from '../../components/La'
import { fieldRegistry } from '../../../services/telemetry-fields'

// Choosing what to plot.
//
// Mission Planner shows every field at once as a grid of several hundred
// checkboxes. It is complete, and it is unusable without already knowing the
// name you want and where it sits. This shows the same set, but filtered as
// you type and grouped by the message each field came from -- with the live
// value beside every row, since half of finding the right field is
// recognising the number next to it.

const REFRESH_MS = 300

export interface FieldPickerProps {
  open: boolean
  selected: readonly string[]
  onToggle: (name: string) => void
  onClose: () => void
}

export default function FieldPicker({ open, selected, onToggle, onClose }: FieldPickerProps) {
  const [filter, setFilter] = useState('')
  const [, tick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => tick((n) => n + 1), REFRESH_MS)
    inputRef.current?.focus()
    return () => clearInterval(id)
  }, [open])

  const names = fieldRegistry.names()
  const needle = filter.trim().toLowerCase()
  const groups = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const name of names) {
      if (needle && !name.toLowerCase().includes(needle)) continue
      const dot = name.indexOf('.')
      const group = dot > 0 ? name.slice(0, dot) : 'Other'
      const list = out.get(group) ?? []
      list.push(name)
      out.set(group, list)
    }
    return [...out.entries()]
    // Recomputed on every tick so newly-seen fields appear; the cost is a
    // string scan over a few hundred names.
  }, [needle, names.length, names])

  const chosen = new Set(selected)

  return (
    <LaModal
      open={open}
      wide
      title="Plot fields"
      actions={
        <LaButton variant="primary" onClick={onClose}>
          Done
        </LaButton>
      }
    >
      <input
        ref={inputRef}
        className="la-input field-picker__filter"
        type="search"
        placeholder={`Filter ${names.length} fields…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter fields"
      />
      <div className="field-picker__groups">
        {groups.length === 0 && (
          <p className="app-placeholder">
            {names.length === 0 ? 'Waiting for telemetry…' : `No field matches “${filter}”.`}
          </p>
        )}
        {groups.map(([group, list]) => (
          <div key={group} className="field-picker__group">
            <h3 className="field-picker__heading">{group}</h3>
            {list.map((name) => {
              const on = chosen.has(name)
              return (
                <button
                  key={name}
                  type="button"
                  className={`field-picker__row${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => onToggle(name)}
                >
                  <span className="field-picker__mark" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="field-picker__name">{name.slice(group.length + 1) || name}</span>
                  <span className="field-picker__value">{fmt(fieldRegistry.latest(name))}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </LaModal>
  )
}

function fmt(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toFixed(0)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(4)
}
