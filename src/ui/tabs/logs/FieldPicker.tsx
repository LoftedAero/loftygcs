import { useMemo, useState } from 'react'
import { LaInput } from '../../components/La'
import { plottableFields } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { isSelected, useLogStore } from '../../../stores/log-store'

// Choosing what to plot, grouped by the message that carries it.
//
// A log has around six hundred plottable fields, so the list is collapsed to
// message names and searched. The search also matches channel labels, so
// "motor" finds RCOU.C1.

export default function FieldPicker() {
  const log = useLogStore((s) => s.log)
  const search = useLogStore((s) => s.search)
  const setSearch = useLogStore((s) => s.setSearch)
  const toggleField = useLogStore((s) => s.toggleField)
  const selectedState = useLogStore((s) => s)
  const [open, setOpen] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    if (!log) return []
    const fields = plottableFields(log)
    const byMessage = new Map<string, { field: string; unit: string; label: string | null }[]>()
    for (const f of fields) {
      const label = fieldLabel(log.params, f.message, f.field)
      const list = byMessage.get(f.message) ?? []
      list.push({ field: f.field, unit: f.unit, label })
      byMessage.set(f.message, list)
    }
    return [...byMessage.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [log])

  const query = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!query) return groups
    return groups
      .map(([name, fields]) => {
        // A message whose own name matches keeps all of its fields.
        if (name.toLowerCase().includes(query)) return [name, fields] as const
        const hits = fields.filter(
          (f) =>
            f.field.toLowerCase().includes(query) ||
            (f.label?.toLowerCase().includes(query) ?? false),
        )
        return [name, hits] as const
      })
      .filter(([, fields]) => fields.length > 0)
  }, [groups, query])

  if (!log) return null

  return (
    <div className="log-picker">
      <LaInput
        type="search"
        placeholder="Search fields — try “motor”"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search log fields"
      />
      <div className="log-picker__list">
        {filtered.map(([message, fields]) => {
          // Search results are always expanded.
          const expanded = query !== '' || open.has(message)
          return (
            <div key={message} className="log-picker__group">
              <button
                type="button"
                className="log-picker__msg"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev)
                    if (next.has(message)) next.delete(message)
                    else next.add(message)
                    return next
                  })
                }
              >
                <span className="log-picker__caret">{expanded ? '▾' : '▸'}</span>
                {message}
                <span className="log-picker__count">{fields.length}</span>
              </button>
              {expanded &&
                fields.map((f) => {
                  const on = isSelected(selectedState, { message, field: f.field })
                  return (
                    <button
                      key={f.field}
                      type="button"
                      className={`log-picker__field${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleField({ message, field: f.field })}
                    >
                      <span className="log-picker__fname">{f.field}</span>
                      {f.label && <span className="log-picker__label">{f.label}</span>}
                      {f.unit && <span className="log-picker__unit">{f.unit}</span>}
                    </button>
                  )
                })}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="app-placeholder">Nothing matches “{search}”.</p>}
      </div>
    </div>
  )
}
