import { useState } from 'react'
import { LaButton, LaCard, LaField, LaInput } from '../../components/La'
import { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import CardParamActions from '../../components/CardParamActions'
import FrameTable from './FrameTable'
import PlaneCards from './PlaneCards'
import { useParamStore } from '../../../stores/param-store'
import {
  hasTunableMotors,
  initialTuneParams,
  isInitialTuneParam,
} from '../../../protocol/initial-tune'
import { FRAME_CLASS_NAMES, frameTypeSupported } from '../../../protocol/frame-layout'

/**
 * The frame, as two dropdowns over a table of every frame we can draw. A
 * plain card rather than a `ParamCard` because the table is not a field.
 * ArduPilot marks both parameters RebootRequired.
 */
function FrameCard() {
  const frameClass = useParamStore((s) => s.entries.get('FRAME_CLASS')?.value)
  const frameType = useParamStore((s) => s.entries.get('FRAME_TYPE')?.value)
  const edit = useParamStore((s) => s.edit)
  const classNames = useParamStore((s) => s.metadata['FRAME_CLASS']?.values)
  const typeNames = useParamStore((s) => s.metadata['FRAME_TYPE']?.values)
  if (frameClass === undefined) return null

  // ArduPilot's motor library rejects a class/type pairing it has no case
  // for: the frame reports UNSUPPORTED, the motors never initialize, and the
  // aircraft will not arm.
  const type = frameType ?? 0
  const bad = !frameTypeSupported(frameClass, type)
  const naming =
    `${classNames?.[frameClass] ?? FRAME_CLASS_NAMES[frameClass] ?? `class ${frameClass}`} ` +
    `${typeNames?.[type] ?? `type ${type}`}`

  return (
    <LaCard
      title="Frame"
      className="frame-card"
      actions={
        <>
          {bad && (
            <span
              className="card-status card-status--bad"
              role="status"
              title={`ArduPilot has no ${naming} layout, so the vehicle will not start its motors.`}
            >
              Unsupported: {naming}
            </span>
          )}
          <CardParamActions
            reason="Frame changes take effect after a restart"
            owns={(param) => param === 'FRAME_CLASS' || param === 'FRAME_TYPE'}
          />
        </>
      }
    >
      <div className="sensor-fields">
        <ParamField param="FRAME_CLASS" label="Frame class" stacked />
        <ParamField param="FRAME_TYPE" label="Frame type" stacked />
      </div>
      {/* Draws every class with a layout for the chosen type, marks the
          current one, and stages a new class when a tile is pressed. */}
      <FrameTable
        frameClass={frameClass}
        frameType={frameType ?? 0}
        onPick={(c) => edit('FRAME_CLASS', c)}
      />
    </LaCard>
  )
}

/**
 * Initial tune parameters from propeller size and battery cell count, as in
 * Mission Planner's Initial Parameter Setup. The arithmetic is in
 * `protocol/initial-tune.ts`.
 *
 * Calculate (or Enter in either field) stages the set; the card's Write sends
 * it and Revert undoes it. The table follows the last Calculate rather than
 * the live fields, since typing "20" passes through "2".
 */
function InitialTuneCard() {
  const entries = useParamStore((s) => s.entries)
  const edit = useParamStore((s) => s.edit)
  const [prop, setProp] = useState(10)
  const [cells, setCells] = useState(4)
  // The inputs Calculate was last pressed with, or null before the first
  // press, in which case nothing is proposed.
  const [calculated, setCalculated] = useState<{ prop: number; cells: number } | null>(null)

  // A fixed wing reports no MOT_* or ATC_*, and no Q_M_*/Q_A_* until
  // Q_ENABLE is on, so there is nothing to tune.
  if (!hasTunableMotors((p) => entries.has(p))) return null

  // The calculation covers both MOT_*/ATC_* and Q_M_*/Q_A_*; only the family
  // this vehicle reports survives. The rows do not depend on the inputs, so
  // the table is laid out before anything is calculated.
  const rows = initialTuneParams({ propInches: 10, cells: 4 }).filter((v) => entries.has(v.param))
  const proposed = calculated
    ? initialTuneParams({ propInches: calculated.prop, cells: calculated.cells }).filter((v) =>
        entries.has(v.param),
      )
    : null

  /** Work out the set for what is in the fields now, and stage it. */
  const calculate = () => {
    setCalculated({ prop, cells })
    for (const { param, value } of initialTuneParams({ propInches: prop, cells })) {
      if (entries.has(param)) edit(param, value)
    }
  }

  return (
    <LaCard
      title="Initial tune"
      className="tune-card"
      actions={
        <CardParamActions
          reason="These take effect after a restart"
          owns={isInitialTuneParam}
          onReverted={() => setCalculated(null)}
        />
      }
    >
      <div className="sensor-fields">
        <LaField label="Propeller diameter" unit="in" htmlFor="tune-prop">
          <LaInput
            id="tune-prop"
            num
            type="number"
            min={1}
            max={60}
            step={0.5}
            value={prop}
            onChange={(e) => setProp(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') calculate()
            }}
          />
        </LaField>
        <LaField label="Battery cells" unit="S" htmlFor="tune-cells">
          <LaInput
            id="tune-cells"
            num
            type="number"
            min={1}
            max={24}
            step={1}
            value={cells}
            onChange={(e) => setCells(Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') calculate()
            }}
          />
        </LaField>
        {/* Beside its inputs, not on the title row with the write actions. */}
        <div className="tune-calc">
          <LaButton variant="secondary" onClick={calculate}>
            Calculate
          </LaButton>
        </div>
      </div>

      {/* The proposal, before anything is written. */}
      <div className="app-table tune-table">
        <div className="app-table__row tune-grid app-table__head">
          <span>Parameter</span>
          <span>Now</span>
          <span>Proposed</span>
        </div>
        {(proposed ?? rows).map(({ param, value }) => {
          // The vehicle's value, not the staged one, which Calculate has
          // already replaced.
          const entry = entries.get(param)
          const now = entry?.origValue ?? entry?.value
          const changes = proposed !== null && now !== value
          return (
            <div className="app-table__row tune-grid" key={param}>
              <span className="app-table__label">{param}</span>
              <span className="tune-grid__now">{now ?? '—'}</span>
              <span className={changes ? 'tune-grid__next' : 'tune-grid__now'}>
                {proposed ? value : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </LaCard>
  )
}

// What the airframe is. These settings change the meaning of everything
// else, so they come first in the rail after firmware.
export default function ConfigurationTab() {
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)
  if (!ready) {
    return <NeedsVehicle title="Configuration" />
  }
  // Only ArduPlane carries Q_ENABLE. MAV_TYPE cannot tell, since a quadplane
  // and a fixed wing both report FIXED_WING (see `takeoffStyle`).
  const isPlane = entries.has('Q_ENABLE')
  return (
    // A multirotor's frame and tune cards sit side by side at one height. A
    // plane's three related cards form a column beside the tune, which is not
    // stretched to match them.
    <div className={isPlane ? 'config-screen config-screen--plane' : 'config-screen'}>
      {/* No parameter describes a plane's airframe, so the plane cards cover
          its flight envelope and lift motors instead. */}
      {isPlane ? <PlaneCards /> : <FrameCard />}
      <InitialTuneCard />
      {/* Board orientation is on Sensors, beside the accelerometer
          calibration it affects. */}
    </div>
  )
}
