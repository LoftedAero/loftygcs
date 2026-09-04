import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LaSelect } from '../../components/La'
import { fieldLabel } from '../../../protocol/log-labels'
import { useLogStore } from '../../../stores/log-store'

// The data table, filtered to one message type at a time.
//
// Mission Planner's model, and the right one: a log holds sixty-odd message
// types with entirely different columns, so "all the records" is not a table
// at all -- it is sixty tables interleaved. Picking the message first is what
// makes the columns mean anything.
//
// Virtualized because a single message can run to sixty thousand records.

export default function LogTable() {
  const log = useLogStore((s) => s.log)
  const message = useLogStore((s) => s.tableMessage)
  const setMessage = useLogStore((s) => s.setTableMessage)
  const scrollRef = useRef<HTMLDivElement>(null)

  const names = useMemo(() => {
    if (!log) return []
    return [...log.messages.keys()].sort()
  }, [log])

  const table = message ? log?.messages.get(message) : undefined
  const rowCount = table?.count ?? 0

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
  })

  if (!log) return null

  return (
    <div className="log-table">
      <div className="log-table__head">
        <label className="log-table__pick">
          <span>Message</span>
          <LaSelect
            value={message ?? ''}
            onChange={(e) => setMessage(e.target.value || null)}
            aria-label="Message type"
          >
            <option value="">Choose a message…</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n} ({log.messages.get(n)!.count})
              </option>
            ))}
          </LaSelect>
        </label>
        {table && (
          <span className="log-table__count">
            {rowCount.toLocaleString()} records · {table.format.fields.length} fields
          </span>
        )}
      </div>

      {!table ? (
        <p className="app-placeholder">
          Pick a message to see its records. Each message type has its own columns, which is why
          they are shown one at a time rather than interleaved.
        </p>
      ) : (
        <div className="log-table__scroll" ref={scrollRef}>
          <table className="log-table__grid">
            <thead>
              <tr>
                {table.format.fields.map((f) => {
                  const named = fieldLabel(log.params, message!, f.name)
                  return (
                    <th key={f.name} scope="col" title={named ?? undefined}>
                      {f.name}
                      {/* Channel functions in the header, so the column
                          says what it is rather than which pin it was. */}
                      {named && <span className="log-table__fn">{named}</span>}
                      {f.unit && <span className="log-table__unit">{f.unit}</span>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((row) => (
                <tr
                  key={row.key}
                  className="log-table__row"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                    height: `${row.size}px`,
                  }}
                >
                  {table.format.fields.map((f) => {
                    const col = table.columns.get(f.name)
                    const v = col ? col[row.index] : undefined
                    return (
                      <td key={f.name}>{typeof v === 'number' ? formatCell(v) : (v ?? '')}</td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatCell(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1e6 || (abs < 1e-4 && abs > 0)) return v.toExponential(3)
  return v.toFixed(abs >= 100 ? 2 : 4)
}
