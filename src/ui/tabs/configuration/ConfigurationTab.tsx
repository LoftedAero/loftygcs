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

// Guided setups are out of scope for the first release, so the card that was
// their only entry point is gone from this screen. The machinery behind it --
// `src/profiles`, the guide store and the runner -- is left in place: it is
// unreachable rather than deleted, because the decision was about shipping
// scope and not about the feature being wrong.

/**
 * The frame, as two dropdowns over a table of every frame we can draw.
 *
 * Built as a card rather than a `ParamCard` because the table is not a field:
 * it is the picture and the picker at once, and a list of parameter rows has
 * nowhere to put it. Both parameters are read at boot -- ArduPilot marks them
 * RebootRequired, measured on 4.7.1 -- so this is the card where the restart
 * prompt actually fires.
 */
function FrameCard() {
  const frameClass = useParamStore((s) => s.entries.get('FRAME_CLASS')?.value)
  const frameType = useParamStore((s) => s.entries.get('FRAME_TYPE')?.value)
  const edit = useParamStore((s) => s.edit)
  const classNames = useParamStore((s) => s.metadata['FRAME_CLASS']?.values)
  const typeNames = useParamStore((s) => s.metadata['FRAME_TYPE']?.values)
  if (frameClass === undefined) return null

  // ArduPilot refuses a pairing its motor library has no case for: the setup
  // returns false, the frame reports UNSUPPORTED and the motors never
  // initialise, so the aircraft will not arm. Worth saying here, where the
  // choice is made, rather than leaving it to be discovered on the bench.
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
      {/* The table is the picture and the picker at once: it draws every class
          that has a layout for the chosen type, marks the one this vehicle is
          set to, and stages a different one when a tile is pressed -- the same
          edit the dropdown above makes. */}
      <FrameTable
        frameClass={frameClass}
        frameType={frameType ?? 0}
        onPick={(c) => edit('FRAME_CLASS', c)}
      />
    </LaCard>
  )
}

/**
 * Initial tune parameters, from propeller size and battery cell count.
 *
 * Mission Planner's Initial Parameter Setup, which is the one thing on its
 * mandatory-hardware screen this app had no answer for. The arithmetic and
 * the sourcing are in `protocol/initial-tune.ts`; this is the two inputs, what
 * they produce, and the button that stages it.
 *
 * Staged, not written: it is a dozen parameters at once on an aircraft that
 * has not flown, so it goes through the same Write the rest of this screen
 * uses, and Revert puts it all back. There is no apply button -- changing
 * either input stages the set, and the card's own Write lights up with the
 * count, which is the same answer the rest of the screen gives.
 *
 * Calculate is what commits, and the table follows it rather than the live
 * fields. That is deliberate: typing "20" passes through "2", so a proposal
 * that tracked every keystroke would flicker through a 2in tune, and tabbing
 * out of a field would quietly stage sixteen parameters nobody asked for. One
 * press, one proposal, one set of staged edits -- and Enter in either field
 * does the same thing, because that is what Enter means in a number box.
 */
function InitialTuneCard() {
  const entries = useParamStore((s) => s.entries)
  const edit = useParamStore((s) => s.edit)
  const [prop, setProp] = useState(10)
  const [cells, setCells] = useState(4)
  // The inputs Calculate was last pressed with, or null before the first
  // press. The table reads this, not the live fields, so what it proposes is
  // always a whole number somebody chose -- and until they have asked, it
  // proposes nothing rather than showing a tune for a propeller size the
  // aircraft may not have.
  const [calculated, setCalculated] = useState<{ prop: number; cells: number } | null>(null)

  // A fixed wing has no multirotor motors, so there is nothing here to
  // compute: measured on ArduPlane 4.7.1, which reports no MOT_*, no ATC_*
  // and -- until Q_ENABLE is on -- no Q_M_*/Q_A_* either. The two INS filters
  // it does share are not an initial tune, and a card holding only those
  // would be a card pretending to do something.
  if (!hasTunableMotors((p) => entries.has(p))) return null

  // Only what this vehicle actually has. The calculation offers a multirotor's
  // MOT_*/ATC_* and a quadplane's Q_M_*/Q_A_* together, and whichever family
  // this aircraft reports is what survives.
  // The rows are the same parameters whatever the inputs, so the table can be
  // laid out before anything is calculated -- which keeps the card one height
  // and lets the proposed column stand empty rather than absent.
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
    // Nothing here is read at boot, so the restart prompt inside these stays
    // quiet for a tune -- it is the same component every card uses.
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
        {/* Beside the two numbers it reads, not on the title row: this makes
            the proposal, where the buttons up there send it. */}
        <div className="tune-calc">
          <LaButton variant="secondary" onClick={calculate}>
            Calculate
          </LaButton>
        </div>
      </div>

      {/* What it will do, before it does it: the same shape as the serial
          table, and the row count does not change with the inputs, so the
          card is one height. */}
      <div className="app-table tune-table">
        <div className="app-table__row tune-grid app-table__head">
          <span>Parameter</span>
          <span>Now</span>
          <span>Proposed</span>
        </div>
        {(proposed ?? rows).map(({ param, value }) => {
          // The vehicle's own value, not the staged one: `value` becomes the
          // store's current reading the moment Calculate stages it, so a
          // column read from there says "25.2 -> 25.2" and stops telling you
          // what is actually on the aircraft.
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

// What the airframe *is*: frame geometry and how the board sits in it.
// These are the settings that change the meaning of everything else, which
// is why they come first in the rail after firmware.
export default function ConfigurationTab() {
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)
  if (!ready) {
    return (
      <NeedsVehicle title="Configuration" />
    )
  }
  // Which aircraft this is, asked of the aircraft: only an ArduPlane build
  // carries Q_ENABLE, and MAV_TYPE cannot be used for it -- a quadplane and a
  // fixed wing both report FIXED_WING, which is the same trap `takeoffStyle`
  // documents in services/flight.ts.
  const isPlane = entries.has('Q_ENABLE')
  return (
    // Two shapes, because the two vehicles have different amounts to say.
    //
    // A multirotor has two peers -- the frame and its tune -- so they sit side
    // by side and the row stretches them to one height, the way Sensors stacks
    // its calibrations beside Hardware ID. A plane has three cards that are one
    // subject and one that is not, so it is a column and a neighbour instead:
    // stretching there would pad the tune to the height of three stacked cards.
    <div className={isPlane ? 'config-screen config-screen--plane' : 'config-screen'}>
      {/* No note about needing a reboot: ArduPilot's own metadata says which
          parameters are read at boot, and the write raises the prompt when it
          lands rather than the screen announcing it in advance. */}
      {/* A plane's frame is its airframe, which no parameter describes, so the
          plane half asks a different question: what envelope is this aircraft
          flown in, and does it have lift motors. */}
      {isPlane ? <PlaneCards /> : <FrameCard />}
      {/* After Frame, because it is the same question one step further: what
          this aircraft is, then how big it is. */}
      <InitialTuneCard />
      {/* Board orientation lives on Sensors, beside the accelerometer
          calibration the setting has to be right for and the picture of what
          it means. The estimator and the MAVLink ids are real settings and
          not initial setup: whoever needs them knows their names, and the
          Parameters tab is where a named parameter is edited. */}
    </div>
  )
}
