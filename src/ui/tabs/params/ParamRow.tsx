import { memo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LaButton, LaModal, LaSelect } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import type { ParamMeta } from '../../../services/param-metadata'

// One parameter row. Memoized: the virtualizer re-renders the visible slice
// on scroll, and only rows whose entry object changed should do work.
//
// Two lines, because a parameter name is not self-describing. ArduPilot ships
// a short display name and a paragraph of description for nearly all ~1400 of
// them, and until now both only appeared in a tooltip -- which is to say, only
// to somebody who already suspected the row was the one they wanted.

/** How the number reads once the metadata is applied to it. */
export function decodeValue(value: number, meta: ParamMeta | undefined): string | null {
  if (!meta) return null
  if (meta.bitmask) return describeBits(value, meta.bitmask)
  const named = meta.values?.[value]
  return named ?? null
}

/** "Gyros, Accels, +2 more" -- what is actually switched on. */
export function describeBits(
  value: number,
  bitmask: NonNullable<ParamMeta['bitmask']>,
  max = 3,
): string {
  const v = Math.trunc(value)
  if (v === 0) return 'none'
  const on: string[] = []
  for (const [bit, label] of Object.entries(bitmask)) {
    if ((v & (1 << Number(bit))) !== 0) on.push(label)
  }
  // A bit the metadata does not name is still set, and saying "none" for a
  // non-zero value would be a lie about the vehicle's configuration.
  if (on.length === 0) return `${v}`
  if (on.length <= max) return on.join(', ')
  return `${on.slice(0, max).join(', ')}, +${on.length - max} more`
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
      <div className="param-row__ident">
        <span className="param-row__name la-selectable">{name}</span>
        {meta?.displayName && <span className="param-row__display">{meta.displayName}</span>}
      </div>

      {meta?.values && !meta.bitmask ? (
        <LaSelect
          value={String(entry.value)}
          aria-label={name}
          onChange={(e) => edit(name, Number(e.target.value))}
          className="param-row__control"
        >
          {/* Both the number and what it means: the number is what the
              vehicle stores, what a forum post quotes and what a .param file
              carries, so hiding it makes the two hard to reconcile. */}
          {Object.entries(meta.values).map(([v, label]) => (
            <option key={v} value={v}>
              {v} — {label}
            </option>
          ))}
          {meta.values[entry.value] === undefined && (
            <option value={String(entry.value)}>{entry.value} — (not a listed option)</option>
          )}
        </LaSelect>
      ) : (
        <input
          className="la-input la-input--num param-row__control"
          type="number"
          aria-label={name}
          step={meta?.increment ?? 'any'}
          value={entry.value}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) edit(name, v)
          }}
        />
      )}

      <span className="param-row__unit">{meta?.units ?? ''}</span>

      {meta?.bitmask ? (
        <LaButton variant="ghost" size="sm" onClick={() => setBitmaskOpen(true)}>
          Bits…
        </LaButton>
      ) : (
        <span />
      )}

      <div className="param-row__meta">
        {/* The decoded value first: on a bitmask row it is the only readable
            form of the number sitting next to it. */}
        {decoded && <span className="param-row__decoded">{decoded}</span>}
        {meta?.description && (
          <span className="param-row__desc" title={meta.description}>
            {meta.description}
          </span>
        )}
        {(meta?.range || meta?.rebootRequired) && (
          <span className="param-row__hint">
            {meta.range ? `${meta.range.low} – ${meta.range.high}` : ''}
            {meta.rebootRequired ? (meta.range ? ' · reboot' : 'reboot') : ''}
          </span>
        )}
      </div>

      {/* Portalled to the body, and it has to be. The virtualizer wraps every
          row in a `transform: translateY(...)`, and a transformed ancestor
          becomes the containing block for position:fixed descendants -- so
          the dialog was being laid out inside a 52px table row and clipped by
          the scrolling list, appearing as a title bar with no content. */}
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

/**
 * The bitmask as checkboxes, Mission Planner's idea. A bitmask parameter is
 * a number nobody can read: ARMING_CHECK 82 is three checks enabled, and
 * working that out by hand is arithmetic in the middle of a bench session.
 */
function BitmaskEditor({
  name,
  displayName,
  value,
  bitmask,
  onApply,
  onCancel,
}: {
  name: string
  displayName?: string | undefined
  value: number
  bitmask: NonNullable<ParamMeta['bitmask']>
  onApply: (v: number) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(Math.trunc(value))
  const bits = Object.entries(bitmask)
  const allOn = bits.every(([bit]) => (v & (1 << Number(bit))) !== 0)

  return (
    <LaModal
      open
      title={displayName ? `${name} — ${displayName}` : name}
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
      <div className="bitmask-list">
        {bits.map(([bit, label]) => {
          const mask = 1 << Number(bit)
          return (
            <label className="la-switch bitmask-row" key={bit}>
              <span className="la-field__unit">
                {label} <span className="bitmask-row__bit">bit {bit}</span>
              </span>
              <input
                type="checkbox"
                checked={(v & mask) !== 0}
                onChange={(e) => setV(e.target.checked ? v | mask : v & ~mask)}
              />
              <span className="la-switch__track"></span>
            </label>
          )
        })}
      </div>
      <div className="bitmask-foot">
        <span className="param-row__hint">
          Value <strong className="bitmask-foot__value">{v}</strong>
          {v !== Math.trunc(value) && <> (was {Math.trunc(value)})</>}
        </span>
        <LaButton
          variant="ghost"
          size="sm"
          onClick={() =>
            setV(allOn ? 0 : bits.reduce((acc, [bit]) => acc | (1 << Number(bit)), 0))
          }
        >
          {allOn ? 'Clear all' : 'Set all'}
        </LaButton>
      </div>
    </LaModal>
  )
}
