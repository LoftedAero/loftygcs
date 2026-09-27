import { memo, useState } from 'react'
import { mdiRestore } from '@mdi/js'
import { createPortal } from 'react-dom'
import { LaButton, LaSelect } from '../../components/La'
import BitmaskEditor, { describeBits } from '../../components/BitmaskEditor'
import { useParamStore } from '../../../stores/param-store'
import type { ParamMeta } from '../../../services/param-metadata'

// One parameter row. Memoized: the virtualizer re-renders the visible slice
// on scroll, and only rows whose entry object changed should do work. The
// description is shown inline, since a parameter name is not self-describing.

/**
 * A bitmask value decoded through its metadata, or null. Named values are
 * shown by the row's dropdown instead.
 */
export function decodeValue(value: number, meta: ParamMeta | undefined): string | null {
  if (!meta?.bitmask) return null
  return describeBits(value, meta.bitmask)
}

export default memo(function ParamRow({ name }: { name: string }) {
  const entry = useParamStore((s) => s.entries.get(name))
  const meta = useParamStore((s) => s.metadata[name])
  const edit = useParamStore((s) => s.edit)
  const [bitmaskOpen, setBitmaskOpen] = useState(false)
  if (!entry) return null

  const decoded = decodeValue(entry.value, meta)

  return (
    <div className={entry.dirty ? 'param-row param-row--dirty' : 'param-row'}>
      <span className="param-row__name la-selectable">{name}</span>

      {/* Every row has the same cells, empty where they do not apply, so the
          columns line up. */}
      <input
        className="la-input la-input--num param-row__value"
        type="number"
        aria-label={name}
        step={meta?.increment ?? 'any'}
        value={entry.value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) edit(name, v)
        }}
      />

      {/* Units sit beside the number, not after the dropdown. */}
      <span className="param-row__unit">{meta?.units ?? ''}</span>

      {/* Reverts this one edit (the column's Revert discards all of them).
          The cell is always present so the row does not shift when staged,
          and the label names the original value. */}
      <span className="param-row__revert">
        {entry.dirty && (
          <button
            type="button"
            className="param-row__revert-btn"
            title={`Revert to ${entry.origValue}`}
            aria-label={`Revert ${name} to ${entry.origValue}`}
            onClick={() => edit(name, entry.origValue)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d={mdiRestore} />
            </svg>
          </button>
        )}
      </span>

      {/* The number and the dropdown are separate fields: the number stays
          editable even when the value is not a listed option. The options
          show names only, since the number is already in its own field (as
          in Mission Planner's parameter list). */}
      {meta?.values && !meta.bitmask ? (
        <LaSelect
          value={String(entry.value)}
          aria-label={`${name} options`}
          onChange={(e) => edit(name, Number(e.target.value))}
          className="param-row__options"
        >
          {Object.entries(meta.values).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
          {meta.values[entry.value] === undefined && (
            <option value={String(entry.value)}>Not a listed option</option>
          )}
        </LaSelect>
      ) : meta?.bitmask ? (
        <LaButton
          variant="ghost"
          className="param-row__options"
          onClick={() => setBitmaskOpen(true)}
        >
          Edit bitmask
        </LaButton>
      ) : (
        <span className="param-row__options" />
      )}

      <div className="param-row__meta">
        {/* On a bitmask row, the only readable form of the number. */}
        {decoded && <span className="param-row__decoded">{decoded}</span>}
        {/* Falls back to the display name; a few parameters have no
            description. */}
        {(meta?.description ?? meta?.displayName) && (
          <span className="param-row__desc" title={meta?.description ?? meta?.displayName}>
            {meta?.description ?? meta?.displayName}
          </span>
        )}
        {(meta?.range || meta?.rebootRequired) && (
          <span className="param-row__hint">
            {meta.range ? `${meta.range.low} – ${meta.range.high}` : ''}
            {meta.rebootRequired ? (meta.range ? ' · reboot' : 'reboot') : ''}
          </span>
        )}
      </div>

      {/* Portaled to the body: the virtualizer puts a transform on every row,
          which makes the row the containing block for position:fixed
          descendants and would clip the dialog inside it. */}
      {bitmaskOpen &&
        meta?.bitmask &&
        createPortal(
          <BitmaskEditor
            name={name}
            displayName={meta.displayName}
            value={entry.value}
            bitmask={meta.bitmask}
            onApply={(v) => {
              edit(name, v)
              setBitmaskOpen(false)
            }}
            onCancel={() => setBitmaskOpen(false)}
          />,
          document.body,
        )}
    </div>
  )
})
