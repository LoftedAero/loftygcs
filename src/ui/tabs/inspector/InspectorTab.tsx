import { useEffect, useMemo } from 'react'
import { LaCard, LaHint, LaInput, LaSwitch } from '../../components/La'
import { connectionService } from '../../../services/connection'
import { useConnectionStore } from '../../../stores/connection-store'
import { rowKey, useInspectorStore } from '../../../stores/inspector-store'
import type { FieldValue } from '../../../protocol/types'

// Everything on the link, live: which messages are arriving, from whom, how
// often, and the latest values. Useful for telling a missing message from a
// display bug.
//
// The worker always counts messages but only builds snapshots while this tab
// is mounted.

export default function InspectorTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const rows = useInspectorStore((s) => s.rows)
  const selectedKey = useInspectorStore((s) => s.selectedKey)
  const select = useInspectorStore((s) => s.select)
  const paused = useInspectorStore((s) => s.paused)
  const setPaused = useInspectorStore((s) => s.setPaused)
  const filter = useInspectorStore((s) => s.filter)
  const setFilter = useInspectorStore((s) => s.setFilter)

  useEffect(() => {
    // Snapshots are built only while this screen is mounted.
    if (!connected) return
    connectionService.setInspecting(true)
    return () => {
      connectionService.setInspecting(false)
      useInspectorStore.getState().clear()
    }
  }, [connected])

  const sorted = useMemo(() => {
    const q = filter.trim().toUpperCase()
    return rows
      .filter((r) => !q || r.msgName.includes(q) || String(r.msgid).includes(q))
      .sort((a, b) => a.msgName.localeCompare(b.msgName) || a.sysid - b.sysid)
  }, [rows, filter])

  const totalHz = rows.reduce((sum, r) => sum + r.hz, 0)
  const selected = rows.find((r) => rowKey(r) === selectedKey) ?? null

  if (!connected) {
    return (
      <LaCard title="MAVLink inspector">
        <p className="app-placeholder">Connect a vehicle to see its messages.</p>
      </LaCard>
    )
  }

  return (
    <div className="inspector">
      {/* The filter bar is the pane's header, inside the frame, as on
          Parameters and MAVFTP, so the pane and the detail column start on
          the same line. */}
      <div className="inspector__pane">
        <div className="inspector__bar">
          <LaInput
            type="search"
            placeholder="Filter messages — try “GPS”"
            aria-label="Filter messages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="inspector__total">
            {rows.length} message types · {totalHz.toFixed(0)} msg/s
          </span>
          <LaSwitch label="Pause" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
        </div>
        <div className="inspector__scroll">
          <table className="inspector__table">
            <thead>
              <tr>
                <th>Message</th>
                <th className="num">ID</th>
                <th className="num">Src</th>
                <th className="num">Hz</th>
                <th className="num">Count</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const key = rowKey(r)
                return (
                  <tr
                    key={key}
                    className={key === selectedKey ? 'is-selected' : undefined}
                    onClick={() => select(key === selectedKey ? null : key)}
                  >
                    <td>{r.msgName}</td>
                    <td className="num">{r.msgid}</td>
                    <td className="num">
                      {r.sysid}:{r.compid}
                    </td>
                    <td className="num">{r.hz >= 9.95 ? r.hz.toFixed(0) : r.hz.toFixed(1)}</td>
                    <td className="num">{r.count.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="app-placeholder">
              {rows.length === 0 ? 'Waiting for traffic…' : `Nothing matches “${filter}”.`}
            </p>
          )}
        </div>
      </div>

      <aside className="app-col-shell">
        <div className="app-col">
          <section className="app-col__group">
            <h3 className="app-col__head">
              {selected ? `${selected.msgName} · ${selected.sysid}:${selected.compid}` : 'Fields'}
            </h3>
            {selected ? (
              <table className="inspector__fields">
                <tbody>
                  {Object.entries(selected.fields).map(([name, value]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{formatValue(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <LaHint>Pick a message.</LaHint>
            )}
            {/* Only messages in this app's dialect can appear: MAVLink's CRC
              folds each message's definition into the checksum, so an
              unknown one cannot survive framing. */}
          </section>
        </div>
      </aside>
    </div>
  )
}

/** A field value at reading precision. */
function formatValue(v: FieldValue): string {
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v)
    return Math.abs(v) >= 1000 ? v.toFixed(1) : v.toPrecision(5)
  }
  if (typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) {
    const shown = v.slice(0, 8).map((n) => (Number.isInteger(n) ? String(n) : n.toPrecision(4)))
    return `[${shown.join(', ')}${v.length > 8 ? `, … ${v.length}` : ''}]`
  }
  return JSON.stringify(v)
}
