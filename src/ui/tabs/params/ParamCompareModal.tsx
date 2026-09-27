import { useEffect, useMemo, useState } from 'react'
import { LaButton, LaHint, LaInput, LaModal } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import { summarize, type CompareRow } from '../../../protocol/param-file'

// Compare a file against the vehicle and choose what to take from it.
//
// Modeled on Mission Planner's compare tool, so a file from a similar aircraft
// is not applied wholesale. Nothing is written here: selected rows are staged
// as ordinary edits and still go through Write.

export interface ParamCompareModalProps {
  open: boolean
  fileName: string
  rows: CompareRow[]
  /** Lines in the file that were not parameters at all. */
  skipped: { line: number; text: string }[]
  onClose: () => void
}

export default function ParamCompareModal({
  open,
  fileName,
  rows,
  skipped,
  onClose,
}: ParamCompareModalProps) {
  const edit = useParamStore((s) => s.edit)
  const metadata = useParamStore((s) => s.metadata)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [showUnchanged, setShowUnchanged] = useState(false)

  const summary = useMemo(() => summarize(rows), [rows])

  // Every difference starts selected, since taking the whole file is the
  // common case.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(rows.filter((r) => r.status === 'changed').map((r) => r.name)))
    setFilter('')
    setShowUnchanged(false)
  }, [open, rows])

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase()
    return rows.filter((r) => {
      if (r.status === 'same' && !showUnchanged) return false
      return !q || r.name.includes(q)
    })
  }, [rows, filter, showUnchanged])

  const selectable = visible.filter((r) => r.status === 'changed')
  const allShown = selectable.length > 0 && selectable.every((r) => selected.has(r.name))

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const apply = () => {
    for (const r of rows) {
      if (r.status === 'changed' && selected.has(r.name)) edit(r.name, r.fileValue)
    }
    onClose()
  }

  if (!open) return null

  return (
    <LaModal
      open
      wide
      title={`Compare with ${fileName}`}
      actions={
        <>
          <LaButton variant="ghost" onClick={onClose}>
            Cancel
          </LaButton>
          <LaButton variant="primary" disabled={selected.size === 0} onClick={apply}>
            Stage {selected.size} change{selected.size === 1 ? '' : 's'}
          </LaButton>
        </>
      }
    >
      <div className="la-row param-compare__tools">
        <LaInput
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="la-grow"
        />
        {/* Two buttons rather than one whose label flips with the selection. */}
        <LaButton
          variant="ghost"
          disabled={selectable.length === 0 || allShown}
          onClick={() =>
            setSelected((prev) => {
              const next = new Set(prev)
              for (const r of selectable) next.add(r.name)
              return next
            })
          }
        >
          Select all
        </LaButton>
        <LaButton
          variant="ghost"
          disabled={selectable.every((r) => !selected.has(r.name))}
          onClick={() =>
            setSelected((prev) => {
              const next = new Set(prev)
              for (const r of selectable) next.delete(r.name)
              return next
            })
          }
        >
          Select none
        </LaButton>
        <label className="la-switch param-compare__toggle">
          <span className="param-compare__toggle-label">Show identical</span>
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={() => setShowUnchanged((v) => !v)}
          />
          <span className="la-switch__track"></span>
        </label>
      </div>

      <p className="param-compare__summary">
        <strong>{summary.changed}</strong> different · {summary.same} identical
        {summary.missing > 0 && (
          <>
            {' · '}
            <span className="param-compare__missing">{summary.missing} not on this vehicle</span>
          </>
        )}
      </p>

      {rows.length === 0 ? (
        <LaHint error>That file contained no parameters.</LaHint>
      ) : summary.changed === 0 ? (
        <LaHint>Every parameter in the file already matches the vehicle.</LaHint>
      ) : (
        <div className="param-compare__scroll">
          <table className="param-compare__table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="mission-table__sr">Take</span>
                </th>
                <th scope="col">Parameter</th>
                <th scope="col" className="mission-table__num">
                  On vehicle
                </th>
                <th scope="col" className="mission-table__num">
                  In file
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.name}
                  className={`param-compare__row is-${r.status}${
                    selected.has(r.name) ? ' is-selected' : ''
                  }`}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Take ${r.name}`}
                      disabled={r.status !== 'changed'}
                      checked={selected.has(r.name)}
                      onChange={() => toggle(r.name)}
                    />
                  </td>
                  <td>
                    <span className="param-compare__name la-selectable">{r.name}</span>
                    {metadata[r.name]?.displayName && (
                      <span className="param-compare__desc">{metadata[r.name]!.displayName}</span>
                    )}
                  </td>
                  <td className="mission-table__num">
                    {r.currentValue === undefined ? (
                      <span className="param-compare__absent">absent</span>
                    ) : (
                      r.currentValue
                    )}
                  </td>
                  <td className="mission-table__num param-compare__new">{r.fileValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.missing > 0 && (
        <LaHint>
          Parameters the vehicle does not have cannot be taken — usually a file from different
          firmware or a different vehicle type.
        </LaHint>
      )}
      {skipped.length > 0 && (
        <LaHint error>
          {skipped.length} line{skipped.length === 1 ? '' : 's'} could not be read (first at line{' '}
          {skipped[0]!.line}).
        </LaHint>
      )}
    </LaModal>
  )
}
