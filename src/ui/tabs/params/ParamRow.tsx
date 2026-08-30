import { memo, useState } from 'react'
import { LaButton, LaModal, LaSelect } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import type { ParamMeta } from '../../../services/param-metadata'

// One parameter row. Memoized: the virtualizer re-renders the visible slice
// on scroll, and only rows whose entry object changed should do work.
export default memo(function ParamRow({ name }: { name: string }) {
  const entry = useParamStore((s) => s.entries.get(name))
  const meta = useParamStore((s) => s.metadata[name])
  const edit = useParamStore((s) => s.edit)
  const [bitmaskOpen, setBitmaskOpen] = useState(false)
  if (!entry) return null

  const title = meta?.description ?? meta?.displayName ?? name

  return (
    <div className={entry.dirty ? 'param-row param-row--dirty' : 'param-row'} title={title}>
      <span className="param-row__name la-selectable">{name}</span>
      {meta?.values && !meta.bitmask ? (
        <LaSelect
          value={String(entry.value)}
          onChange={(e) => edit(name, Number(e.target.value))}
          className="param-row__control"
        >
          {Object.entries(meta.values).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
          {meta.values[entry.value] === undefined && (
            <option value={String(entry.value)}>{entry.value}</option>
          )}
        </LaSelect>
      ) : (
        <input
          className="la-input la-input--num param-row__control"
          type="number"
          step={meta?.increment ?? 'any'}
          value={entry.value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) edit(name, v)
          }}
        />
      )}
      <span className="param-row__unit">{meta?.units ?? ''}</span>
      {meta?.bitmask && (
        <LaButton variant="ghost" size="sm" onClick={() => setBitmaskOpen(true)}>
          bits…
        </LaButton>
      )}
      <span className="param-row__hint">
        {meta?.range ? `${meta.range.low} – ${meta.range.high}` : ''}
        {meta?.rebootRequired ? ' · reboot' : ''}
      </span>
      {bitmaskOpen && meta?.bitmask && (
        <BitmaskEditor
          name={name}
          value={entry.value}
          bitmask={meta.bitmask}
          onApply={(v) => {
            edit(name, v)
            setBitmaskOpen(false)
          }}
          onCancel={() => setBitmaskOpen(false)}
        />
      )}
    </div>
  )
})

function BitmaskEditor({
  name,
  value,
  bitmask,
  onApply,
  onCancel,
}: {
  name: string
  value: number
  bitmask: NonNullable<ParamMeta['bitmask']>
  onApply: (v: number) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(Math.trunc(value))
  return (
    <LaModal
      open
      title={name}
      actions={
        <>
          <LaButton variant="ghost" onClick={onCancel}>
            Cancel
          </LaButton>
          <LaButton variant="primary" onClick={() => onApply(v)}>
            Apply
          </LaButton>
        </>
      }
    >
      {Object.entries(bitmask).map(([bit, label]) => {
        const mask = 1 << Number(bit)
        return (
          <label className="la-switch bitmask-row" key={bit}>
            <span className="la-field__unit">{label}</span>
            <input
              type="checkbox"
              checked={(v & mask) !== 0}
              onChange={(e) => setV(e.target.checked ? v | mask : v & ~mask)}
            />
            <span className="la-switch__track"></span>
          </label>
        )
      })}
      <p className="la-card__note">Value: {v}</p>
    </LaModal>
  )
}
