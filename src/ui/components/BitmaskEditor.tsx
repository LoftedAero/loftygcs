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
  const all = on.join(', ')
  if (on.length <= max) return all
  // Shortening only earns its place when it is shorter: "Roll, Pitch, Yaw"
  // beats "Roll, Pitch, +1 more", which costs more room and says less.
  const short = `${on.slice(0, max).join(', ')}, +${on.length - max} more`
  return all.length <= short.length ? all : short
}

/**
 * The longest single name a compact bitmask shows instead of a count. The
 * narrowest place one is drawn is the OSD column, where "UseDecimalPack" (14)
 * was clipped to "UseDecimalPac"; twelve fits there.
 */
const ONE_NAME_MAX = 12

/**
 * "2 selected", or "none" -- a bitmask's summary where its names will not fit.
 *
 * One short name is shown as itself: RC_PROTOCOLS at 1 is "All", and "1
 * selected" said less in more room.
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
