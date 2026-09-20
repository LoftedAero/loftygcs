import { useState } from 'react'
import { LaButton, LaModal } from './La'
import type { ParamMeta } from '../../services/param-metadata'

// A bitmask parameter as checkboxes, Mission Planner's idea. A bitmask is a
// number nobody can read: ARMING_CHECK 82 is three checks enabled, and working
// that out by hand is arithmetic in the middle of a bench session.
//
// Shared rather than living in the Parameters table, because a curated screen
// hits exactly the same wall: `SERIALn_OPTIONS` carries no named values, so
// `ParamField` fell through to a plain number box and the Ports page asked
// people to type a mask. Any field bound to a bitmask parameter gets this.

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

export default function BitmaskEditor({
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
              <span className="bitmask-row__name">{label}</span>
              <span className="bitmask-row__bit">bit {bit}</span>
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
      {/* What the switches add up to, which is the number the vehicle
          actually stores and the only thing here a `.param` file carries. */}
      <div className="bitmask-foot">
        <span className="bitmask-foot__label">Value</span>
        <span className="bitmask-foot__value">{v}</span>
        {v !== Math.trunc(value) && (
          <span className="bitmask-foot__was">was {Math.trunc(value)}</span>
        )}
      </div>
    </LaModal>
  )
}
