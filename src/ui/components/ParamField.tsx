import { LaSelect } from './La'
import { useParamStore } from '../../stores/param-store'

// One control bound to a parameter by name -- the building block of every
// curated view. Edits stage in the param store exactly like the Parameters
// tab, so the action bar's Write Params covers all of them and nothing
// reaches the vehicle on keystroke.
//
// `bare` drops the label wrapper for table layouts (Ports, Outputs), where
// the column heading is the label.
export default function ParamField({
  param,
  label,
  unit,
  bare,
}: {
  param: string
  label: string
  unit?: string
  bare?: boolean
}) {
  const entry = useParamStore((s) => s.entries.get(param))
  const meta = useParamStore((s) => s.metadata[param])
  const edit = useParamStore((s) => s.edit)

  if (!entry) {
    if (bare) return <span className="la-muted">—</span>
    return (
      <div className="la-field">
        <label className="la-field__label">{label}</label>
        <span className="la-muted">not on this vehicle</span>
      </div>
    )
  }

  const control = meta?.values ? (
    <LaSelect
      value={String(entry.value)}
      onChange={(e) => edit(param, Number(e.target.value))}
      className={entry.dirty ? 'is-dirty' : ''}
      title={meta.description ?? param}
    >
      {Object.entries(meta.values).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
      {meta.values[entry.value] === undefined && (
        <option value={String(entry.value)}>{entry.value}</option>
      )}
    </LaSelect>
  ) : (
    <input
      className={entry.dirty ? 'la-input la-input--num is-dirty' : 'la-input la-input--num'}
      type="number"
      step={meta?.increment ?? 'any'}
      value={entry.value}
      title={meta?.description ?? param}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) edit(param, v)
      }}
    />
  )

  if (bare) return control

  const unitText = unit ?? meta?.units
  return (
    <div className="la-field" title={meta?.description ?? param}>
      <label className="la-field__label">
        {label} {unitText && <span className="la-field__unit">{unitText}</span>}
      </label>
      {control}
    </div>
  )
}
