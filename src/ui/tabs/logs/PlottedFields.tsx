import { LaButton, LaHint } from '../../components/La'
import { fieldUnit } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { MAX_AXES, useLogStore } from '../../../stores/log-store'

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

/** Matches LogPlot's trace colors, so a row points at its own line. */
const COLORS = [
  '#F7941D',
  '#4684C5',
  '#2FAE4E',
  '#D63031',
  '#8E44AD',
  '#16A085',
  '#E67E22',
  '#2C3E50',
]

export default function PlottedFields() {
  const log = useLogStore((s) => s.log)
  const selected = useLogStore((s) => s.selected)
  const setFieldAxis = useLogStore((s) => s.setFieldAxis)
  const toggleField = useLogStore((s) => s.toggleField)
  const clearFields = useLogStore((s) => s.clearFields)
  const gatherAxes = useLogStore((s) => s.gatherAxes)

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
        const named = fieldLabel(log.params, f.message, f.field)
        const unit = fieldUnit(log, f.message, f.field)
        return (
          <div key={`${f.message}.${f.field}`} className="plotted">
            <div className="plotted__head">
              <span className="plotted__swatch" style={{ background: COLORS[i % COLORS.length] }} />
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
            <div className="plotted__meta">
              {named && <span className="plotted__fn">{named}</span>}
              {unit && <span className="plotted__unit">{unit}</span>}
            </div>
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
    </section>
  )
}
