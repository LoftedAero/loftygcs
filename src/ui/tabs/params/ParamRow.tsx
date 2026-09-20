import { memo, useState } from 'react'
import { mdiRestore } from '@mdi/js'
import { createPortal } from 'react-dom'
import { LaButton, LaSelect } from '../../components/La'
import BitmaskEditor, { describeBits } from '../../components/BitmaskEditor'
import { useParamStore } from '../../../stores/param-store'
import type { ParamMeta } from '../../../services/param-metadata'

// One parameter row. Memoized: the virtualizer re-renders the visible slice
// on scroll, and only rows whose entry object changed should do work.
//
// Two lines, because a parameter name is not self-describing. ArduPilot ships
// a short display name and a paragraph of description for nearly all ~1400 of
// them, and until now both only appeared in a tooltip -- which is to say, only
// to somebody who already suspected the row was the one they wanted.

/**
 * How the number reads once the metadata is applied to it — for bitmasks
 * only. A parameter with named values now shows them in a dropdown of its
 * own, so repeating the label here would say the same thing twice and take
 * the room from the description.
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

      {/* Every row has the same cells in the same places, empty where they do
          not apply. A grid whose columns move depending on the parameter is
          one you have to re-read for every row; holding them still is what
          lets the eye run down a column of values. */}
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

      {/* Units sit with the number they qualify, not after the dropdown --
          "rad" belongs to 0.0175, and a column between them made it read as
          a unit for the option list. */}
      <span className="param-row__unit">{meta?.units ?? ''}</span>

      {/* Undo this one edit, beside the value it undoes.
          The column's Revert changes throws away every staged edit at once,
          which is the wrong instrument for "that one was a typo" in a table
          of eight hundred rows -- there was no way to put a single value
          back except remembering it and typing it again. The cell is always
          in the grid so a row does not move when it becomes staged, and it
          carries the old value in its label rather than only in a tooltip:
          "revert" is only actionable if you can see what it reverts to. */}
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

      {/* The number and the dropdown are separate fields rather than one
          control that changes shape: the number is what the vehicle stores
          and what a .param file carries, and it stays editable even when the
          value is not one of the listed options.

          Which is also why the options carry no number of their own. They
          read "Disabled", not "0 - Disabled": the value is already in the
          field two columns left, on every row, and repeating it put the same
          digit twice on one line. Mission Planner's raw parameter list makes
          the same split -- its combo binds `DisplayMember = "Value"`, the
          description, against `ValueMember = "Key"`, the number -- and it is
          the list every ArduPilot user has already read. The cost is that a
          wiki page saying "set this to 2" cannot be matched against the open
          list; typing 2 into the field is the shorter route to that anyway. */}
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
        {/* The decoded value first: on a bitmask row it is the only readable
            form of the number sitting next to it. */}
        {decoded && <span className="param-row__decoded">{decoded}</span>}
        {/* Falls back to the display name: this column is now the only place
            a parameter says what it is, and a handful have the short name
            without the paragraph. */}
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

