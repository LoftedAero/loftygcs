import type { ReactNode } from 'react'
import { create } from 'zustand'
import { LaButton, LaInput, LaSelect } from '../../components/La'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, formatDistance, fromDistance, toDistance } from '../../../units'
import { useMissionStore } from '../../../stores/mission-store'
import { usePlanVehicleClass } from './plan-vehicle'
import { commandChange } from './MissionTable'
import { legStats, hasCoords, type PlanItem } from '../../../protocol/mission-plan'
import {
  MAV_FRAMES,
  commandsFor,
  commandSpec,
  commandLabel,
} from '../../../protocol/mission-commands'

// Compact Plan's editor for one mission item, in the side panel's Items tab,
// opened by tapping its marker or its line in the item list; Done goes back
// to the list. It holds what a table row holds on the desktop,
// stacked for a narrow panel and sized for a finger, so no table has to
// scroll sideways on a small screen.

/** Which item the editor shows; null when it is closed. */
export const useItemEditor = create<{
  uid: string | null
  open: (uid: string) => void
  close: () => void
}>((set) => ({
  uid: null,
  open: (uid) => set({ uid }),
  close: () => set({ uid: null }),
}))

/** Altitude steps, in the display unit: five meters or ten feet. */
const ALT_STEP = { m: 5, ft: 10 } as const

export default function ItemEditor() {
  const uid = useItemEditor((s) => s.uid)
  const close = useItemEditor((s) => s.close)
  const plan = useMissionStore((s) => s.plan)
  const update = useMissionStore((s) => s.updateItem)
  const remove = useMissionStore((s) => s.removeItem)
  const move = useMissionStore((s) => s.moveItem)
  const planClass = usePlanVehicleClass()
  const units = useUnits()

  const index = plan.items.findIndex((it) => it.uid === uid)
  const item = index >= 0 ? plan.items[index] : undefined
  if (!item) return null

  const seq = index + 1
  const spec = commandSpec(item.command)
  const params = spec?.params ?? []
  const legM = legStats(plan)[index]?.legM ?? 0
  const change = (patch: Partial<Omit<PlanItem, 'uid'>>) => update(item.uid, patch)
  const unit = distanceLabel(units.distance)
  const alt = round(toDistance(item.z, units.distance))
  const step = units.distance === 'ft' ? ALT_STEP.ft : ALT_STEP.m
  const setAlt = (v: number) => change({ z: fromDistance(v, units.distance) })

  return (
    <section className="item-editor" aria-label={`Item ${seq}`}>
      <div className="item-editor__head">
        <h3 className="item-editor__title">Item {seq}</h3>
        {hasCoords(item) && index > 0 && (
          <span className="item-editor__leg">
            {formatDistance(legM, units.distance, 0)} {unit} from {seq - 1}
          </span>
        )}
        <LaButton variant="ghost" className="item-editor__close" onClick={close}>
          Done
        </LaButton>
      </div>

      <div className="item-editor__body">
        <label className="item-editor__field">
          <span className="la-field__label">Command</span>
          <LaSelect
            value={item.command}
            onChange={(e) => change(commandChange(Number(e.target.value)))}
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
              <LaInput
                num
                type="number"
                aria-label={`Item ${seq} altitude`}
                value={alt}
                onChange={(e) => setAlt(Number(e.target.value))}
              />
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
                <LaInput
                  num
                  type="number"
                  step={p.integer ? 1 : 'any'}
                  {...(p.min !== undefined ? { min: p.min } : {})}
                  {...(p.max !== undefined ? { max: p.max } : {})}
                  value={round(item[key])}
                  onChange={(e) => change({ [key]: Number(e.target.value) })}
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
 * The item list for compact mode: one line per item, a finger wide, each
 * opening the editor. The desktop table's columns do not fit a small window.
 */
export function ItemList({ foot }: { foot?: ReactNode }) {
  const plan = useMissionStore((s) => s.plan)
  const selected = useMissionStore((s) => s.selected)
  const select = useMissionStore((s) => s.select)
  const addAfter = useMissionStore((s) => s.addItemAfter)
  const open = useItemEditor((s) => s.open)
  const units = useUnits()
  const unit = distanceLabel(units.distance)

  return (
    <div className="item-list">
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
            <span className="item-list__cmd">{spec?.name ?? commandLabel(it.command)}</span>
            <span className="item-list__alt">
              {spec?.altitude === false ? '' : `${formatDistance(it.z, units.distance, 0)} ${unit}`}
            </span>
          </button>
        )
      })}
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
        {foot}
      </div>
    </div>
  )
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
