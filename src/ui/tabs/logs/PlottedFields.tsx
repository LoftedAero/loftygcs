import { useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { fieldUnit, getSeries, seriesStats } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { logEnd } from '../../../protocol/log-modes'
import { MAX_AXES, TRACE_COLORS, traceColor, useLogStore } from '../../../stores/log-store'

// What is on the plot, and which y axis each trace is drawn against.
//
// The axis assignment is the point of this list. Two traces on one axis are
// directly comparable and two on separate axes are not, so which is which
// has to be a choice rather than something inferred -- desired roll against
// actual roll means nothing on separate scales, and an altitude against a
// servo output means nothing on the same one.
//
// Defaults get it right often enough that most people will never touch it:
// fields sharing a unit land on the same axis, a new unit takes the next
// free one. See defaultAxis in the store.

export default function PlottedFields() {
  const log = useLogStore((s) => s.log)
  const selected = useLogStore((s) => s.selected)
  const setFieldAxis = useLogStore((s) => s.setFieldAxis)
  const toggleField = useLogStore((s) => s.toggleField)
  const clearFields = useLogStore((s) => s.clearFields)
  const gatherAxes = useLogStore((s) => s.gatherAxes)
  const setFieldColor = useLogStore((s) => s.setFieldColor)
  const timeWindow = useLogStore((s) => s.timeWindow)
  const [picking, setPicking] = useState<string | null>(null)

  if (!log) return null
  if (selected.length === 0) {
    return (
      <section className="app-col__group">
        <h3 className="app-col__head">Plotted</h3>
        <LaHint>Nothing yet. Pick fields from the list on the left.</LaHint>
      </section>
    )
  }

  return (
    <section className="app-col__group">
      <div className="app-col__headrow">
        <h3 className="app-col__head">Plotted</h3>
        <span className="mission-badge">{selected.length}</span>
      </div>

      {selected.map((f, i) => {
        const id = `${f.message}.${f.field}`
        const named = fieldLabel(log.params, f.message, f.field)
        const unit = fieldUnit(log, f.message, f.field)
        const color = traceColor(f, i)
        const series = getSeries(log, f.message, f.field)
        // Over the visible window, not the whole log: the number worth
        // reading is the one for what is on screen.
        const stats = series
          ? seriesStats(series, timeWindow?.t0 ?? 0, timeWindow?.t1 ?? logEnd(log))
          : null
        return (
          <div key={id} className="plotted">
            <div className="plotted__head">
              <button
                type="button"
                className="plotted__swatch plotted__swatch--button"
                style={{ background: color }}
                aria-label={`Color for ${id}`}
                aria-expanded={picking === id}
                onClick={() => setPicking(picking === id ? null : id)}
              />
              <span className="plotted__name">
                {f.message}.{f.field}
              </span>
              <button
                type="button"
                className="fence-item__x"
                aria-label={`Remove ${f.message}.${f.field}`}
                onClick={() => toggleField(f)}
              >
                ✕
              </button>
            </div>
            {picking === id && (
              <div className="plotted__palette" role="group" aria-label={`Colors for ${id}`}>
                {TRACE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`plotted__chip${color === c ? ' is-active' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => {
                      setFieldColor(f, c)
                      setPicking(null)
                    }}
                  />
                ))}
              </div>
            )}
            <div className="plotted__meta">
              {named && <span className="plotted__fn">{named}</span>}
              {unit && <span className="plotted__unit">{unit}</span>}
            </div>
            {stats && stats.count > 0 && (
              <dl className="plotted__stats">
                <div>
                  <dt>min</dt>
                  <dd>{fmt(stats.min)}</dd>
                </div>
                <div>
                  <dt>max</dt>
                  <dd>{fmt(stats.max)}</dd>
                </div>
                <div>
                  <dt>avg</dt>
                  <dd>{fmt(stats.mean)}</dd>
                </div>
              </dl>
            )}
            <div
              className="plotted__axes"
              role="radiogroup"
              aria-label={`Y axis for ${f.message}.${f.field}`}
            >
              {Array.from({ length: MAX_AXES }, (_, axis) => (
                <button
                  key={axis}
                  type="button"
                  role="radio"
                  aria-checked={f.axis === axis}
                  className={`plotted__axis${f.axis === axis ? ' is-active' : ''}`}
                  title={`Draw against y axis ${axis + 1}`}
                  onClick={() => setFieldAxis(f, axis)}
                >
                  Y{axis + 1}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {selected.length > 1 && (
        <div className="la-row">
          <LaButton variant="ghost" size="sm" onClick={() => gatherAxes('one')}>
            All on Y1
          </LaButton>
          <LaButton variant="ghost" size="sm" onClick={() => gatherAxes('each')}>
            One each
          </LaButton>
        </div>
      )}
      <LaButton variant="ghost" size="block" onClick={clearFields}>
        Clear {selected.length} {selected.length === 1 ? 'field' : 'fields'}
      </LaButton>
      {timeWindow && <LaHint>Statistics are for the zoomed range, not the whole log.</LaHint>}
    </section>
  )
}

/** Compact enough for a narrow column, without lying about the value. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e5 || (abs < 1e-3 && abs > 0)) return v.toExponential(1)
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(3)
}
