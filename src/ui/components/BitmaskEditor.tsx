import { useState } from 'react'
import { LaButton, LaModal } from './La'
import type { ParamMeta } from '../../services/param-metadata'

// A bitmask parameter as a set of switches, as Mission Planner does
// (ARMING_CHECK 82 is three checks enabled). Shared by the Parameters table
// and any curated field bound to a bitmask parameter, such as SERIALn_OPTIONS.

/** What is switched on, e.g. "Gyros, Accels, +2 more". */
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
  // A bit the metadata does not name is still set; never say "none" for a
  // non-zero value.
  if (on.length === 0) return `${v}`
  const all = on.join(', ')
  if (on.length <= max) return all
  // Only shorten when it is actually shorter: "Roll, Pitch, Yaw" beats
  // "Roll, Pitch, +1 more".
  const short = `${on.slice(0, max).join(', ')}, +${on.length - max} more`
  return all.length <= short.length ? all : short
}

/**
 * The longest single name a compact bitmask shows instead of a count; twelve
 * characters fit the narrowest place one is drawn, the OSD column.
 */
const ONE_NAME_MAX = 12

/**
 * "2 selected" or "none": a bitmask's summary where its names will not fit.
 * A single short name is shown as itself (RC_PROTOCOLS at 1 is "All").
 */
export function countBits(value: number, bitmask?: NonNullable<ParamMeta['bitmask']>): string {
  let v = Math.trunc(value) >>> 0
  let n = 0
  let only = -1
  for (let bit = 0; v; bit++, v >>>= 1) {
    if (v & 1) {
      n++
      only = bit
    }
  }
  const name = n === 1 ? bitmask?.[only] : undefined
  if (name !== undefined && name.length <= ONE_NAME_MAX) return name
  return n === 0 ? 'none' : `${n} selected`
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
      {/* The value the switches add up to, which is what the vehicle stores. */}
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
