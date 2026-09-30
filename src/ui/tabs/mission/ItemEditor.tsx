import { useEffect, useRef, useState } from 'react'
import { LaButton, LaInput, LaSelect } from '../../components/La'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, formatDistance, fromDistance, toDistance } from '../../../units'
import { useMissionStore } from '../../../stores/mission-store'
import { useItemEditor } from '../../../stores/item-editor-store'
import { usePlanVehicleClass } from './plan-vehicle'
import { legStats, hasCoords, type PlanItem } from '../../../protocol/mission-plan'
import {
  MAV_FRAMES,
  commandsFor,
  commandSpec,
  commandLabel,
} from '../../../protocol/mission-commands'

// Compact Plan's editor for one mission item, in the item sheet across its
// width, opened by tapping the item's marker or its line in the list; "All
// items" goes back to the list. It holds what a table row holds on the
// desktop, sized for a finger, so no table scrolls sideways on a small
// screen.

/** Altitude steps, in the display unit: five meters or ten feet. */
const ALT_STEP = { m: 5, ft: 10 } as const

export default function ItemEditor() {
  const uid = useItemEditor((s) => s.uid)
  const close = useItemEditor((s) => s.close)
  const plan = useMissionStore((s) => s.plan)
  const update = useMissionStore((s) => s.updateItem)
  const changeCommand = useMissionStore((s) => s.changeCommand)
  const remove = useMissionStore((s) => s.removeItem)
  const move = useMissionStore((s) => s.moveItem)
  const planClass = usePlanVehicleClass()
  const units = useUnits()
  const title = useRef<HTMLHeadingElement>(null)

  const index = plan.items.findIndex((it) => it.uid === uid)
  const item = index >= 0 ? plan.items[index] : undefined

  // An item that disappears (a read from the vehicle replaces the plan)
  // closes the editor rather than leaving it empty.
  useEffect(() => {
    if (uid && !item) close()
  }, [uid, item, close])
  // Focus follows the editor in, since the row that opened it is gone.
  useEffect(() => title.current?.focus(), [uid])

  if (!item) return null

  const seq = index + 1
  const spec = commandSpec(item.command)
  const params = spec?.params ?? []
  const change = (patch: Partial<Omit<PlanItem, 'uid'>>) => update(item.uid, patch)
  const unit = distanceLabel(units.distance)
  const alt = toDistance(item.z, units.distance)
  const step = units.distance === 'ft' ? ALT_STEP.ft : ALT_STEP.m
  const setAlt = (v: number) => change({ z: fromDistance(v, units.distance) })

  // The leg is measured from the last item with a position, or from home.
  let from: string | null = null
  if (hasCoords(item)) {
    for (let j = index - 1; j >= 0 && from === null; j--) {
      const prev = plan.items[j]
      if (prev && hasCoords(prev)) from = String(j + 1)
    }
    if (from === null && plan.home) from = 'home'
  }
  const legM = legStats(plan)[index]?.legM ?? 0

  return (
    <section className="item-editor" aria-label={`Item ${seq}`}>
      <div className="item-editor__head">
        <h3 className="item-editor__title" ref={title} tabIndex={-1}>
          Item {seq}
        </h3>
        {from !== null && (
          <span className="item-editor__leg">
            {formatDistance(legM, units.distance, 0)} {unit} from {from}
          </span>
        )}
        <LaButton variant="ghost" className="item-editor__back" onClick={close}>
          All items
        </LaButton>
      </div>

      <div className="item-editor__body">
        <label className="item-editor__field">
          <span className="la-field__label">Command</span>
          <LaSelect
            value={item.command}
            onChange={(e) => changeCommand(item.uid, Number(e.target.value))}
          >
            {!spec && <option value={item.command}>{commandLabel(item.command)}</option>}
            {commandsFor(planClass).map((c) => (
              <option key={c.id} value={c.id}>
                {c.mavName}
              </option>
            ))}
          </LaSelect>
        </label>

        {spec?.altitude !== false && (
          <div className="item-editor__field">
            <span className="la-field__label">
              Altitude <span className="la-field__unit">{unit}</span>
            </span>
            <div className="item-editor__alt">
              <LaButton variant="ghost" aria-label="Lower" onClick={() => setAlt(alt - step)}>
                −
              </LaButton>
              <NumberField label={`Item ${seq} altitude`} value={alt} onValue={setAlt} />
              <LaButton variant="ghost" aria-label="Higher" onClick={() => setAlt(alt + step)}>
                +
              </LaButton>
            </div>
          </div>
        )}

        {!(spec && !spec.location && !spec.altitude) && (
          <label className="item-editor__field">
            <span className="la-field__label">Altitude mode</span>
            <LaSelect
              value={item.frame}
              onChange={(e) => change({ frame: Number(e.target.value) })}
            >
              {MAV_FRAMES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </LaSelect>
          </label>
        )}

        {params.map((p) => {
          const key = `param${p.index}` as 'param1' | 'param2' | 'param3' | 'param4'
          return (
            <label key={p.index} className="item-editor__field">
              <span className="la-field__label">
                {p.label} {p.unit && <span className="la-field__unit">{p.unit}</span>}
              </span>
              {p.options ? (
                <LaSelect
                  value={item[key]}
                  onChange={(e) => change({ [key]: Number(e.target.value) })}
                >
                  {p.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </LaSelect>
              ) : (
                <NumberField
                  value={item[key]}
                  integer={p.integer ?? false}
                  {...(p.min !== undefined ? { min: p.min } : {})}
                  {...(p.max !== undefined ? { max: p.max } : {})}
                  onValue={(v) => change({ [key]: v })}
                />
              )}
            </label>
          )
        })}
      </div>

      <div className="item-editor__foot">
        <LaButton variant="ghost" disabled={index === 0} onClick={() => move(item.uid, index - 1)}>
          Earlier
        </LaButton>
        <LaButton
          variant="ghost"
          disabled={index === plan.items.length - 1}
          onClick={() => move(item.uid, index + 1)}
        >
          Later
        </LaButton>
        <LaButton
          variant="danger"
          onClick={() => {
            remove(item.uid)
            close()
          }}
        >
          Delete
        </LaButton>
      </div>
    </section>
  )
}

/**
 * A number box that keeps what is typed until it is a number. Clearing it on
 * a touch keyboard, or typing a lone minus, would otherwise write 0 at once
 * and put the item on the ground; the field goes back to the stored value when
 * it loses focus.
 */
function NumberField({
  value,
  onValue,
  label,
  integer = false,
  min,
  max,
}: {
  value: number
  onValue: (v: number) => void
  label?: string
  integer?: boolean
  min?: number
  max?: number
}) {
  const shown = String(round(value))
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <LaInput
      num
      type="number"
      step={integer ? 1 : 'any'}
      {...(label ? { 'aria-label': label } : {})}
      {...(min !== undefined ? { min } : {})}
      {...(max !== undefined ? { max } : {})}
      value={draft ?? shown}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const v = Number(text)
        if (text.trim() !== '' && Number.isFinite(v)) onValue(v)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/**
 * The item list for compact mode: one line per item, a finger tall, each
 * opening the editor. Add sits under the list, outside its scrolling, so it
 * stays in the same place however many items there are.
 */
export function ItemList() {
  const plan = useMissionStore((s) => s.plan)
  const selected = useMissionStore((s) => s.selected)
  const select = useMissionStore((s) => s.select)
  const addAfter = useMissionStore((s) => s.addItemAfter)
  const open = useItemEditor((s) => s.open)
  const units = useUnits()
  const unit = distanceLabel(units.distance)

  return (
    <div className="item-list">
      <div className="item-list__rows">
        {plan.items.map((it, i) => {
          const spec = commandSpec(it.command)
          return (
            <button
              key={it.uid}
              type="button"
              className={`item-list__row${selected === it.uid ? ' is-selected' : ''}`}
              onClick={() => {
                select(it.uid)
                open(it.uid)
              }}
            >
              <span className="item-list__seq">{i + 1}</span>
              {/* ArduPilot's names, as in the editor and the desktop table. */}
              <span className="item-list__cmd">{spec?.mavName ?? commandLabel(it.command)}</span>
              <span className="item-list__alt">
                {spec?.altitude === false
                  ? '—'
                  : `${formatDistance(it.z, units.distance, 0)} ${unit}`}
              </span>
            </button>
          )
        })}
      </div>
      <div className="item-list__foot">
        <LaButton
          variant="secondary"
          onClick={() => {
            const uid = addAfter(-1)
            open(uid)
          }}
        >
          Add waypoint
        </LaButton>
      </div>
    </div>
  )
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
