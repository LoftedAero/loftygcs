import { LaCard } from '../../components/La'
import ParamCard from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import CardParamActions from '../../components/CardParamActions'
import FrameDiagram from './FrameDiagram'
import { useParamStore } from '../../../stores/param-store'
import { FRAME_CLASS_NAMES, frameTiles } from '../../../protocol/frame-layout'

// The Configuration screen for a fixed wing, which is a different question
// from a multirotor's.
//
// A Copter's frame *is* the aircraft, so that screen is a picture of it and a
// size. No parameter describes a plane's airframe at all -- measured on
// ArduPlane 4.7.1-beta, which reports no FRAME_CLASS, no FRAME_TYPE and no
// MOT_* -- so what is configurable here is what the airframe is: how fast it
// is meant to go, and whether it has VTOL motors bolted on. Those are the
// numbers whose defaults describe ArduPilot's own bench model rather than
// anybody's aeroplane.
//
// How far it may lean was here too, as a Flight envelope card, and moved to
// Tuning's Attitude card: a Copter's lean limit lives only on Tuning, Mission
// Planner keeps the plane's "Nav angles" on its tuning page, and they are
// limits the controller flies to rather than facts about the airframe.
//
// **Every name here was read off a running vehicle**, because 4.4 renamed
// this whole set off its centi-unit spellings and the guides still give the
// old ones: `TRIM_ARSPD_CM` and `ARSPD_FBW_MIN/MAX` come back empty on 4.7.
// The legacy names are
// deliberately *not* carried alongside the new ones the way `initial-tune.ts`
// carries `ATC_ACCEL_*`: those differ only in spelling, where these differ in
// **unit** -- centidegrees against degrees, cm/s against m/s -- and a field
// that labels a legacy parameter with the current unit is a mislabelled
// airspeed, which is the one class of error worth refusing to guess at.

/**
 * Whether this aircraft has VTOL motors, and what they are arranged as.
 *
 * `Q_ENABLE` is the only `Q_` parameter a fixed wing reports: with it at 0 the
 * vehicle carries no `Q_FRAME_*`, no `Q_M_*` and no `Q_A_*` at all. Written to
 * 1, it reports all of them at once, with no restart -- measured on ArduPlane
 * 4.7.1, 1,419 parameters to 1,619, and "QuadPlane initialised" arrives
 * as it happens. So it is `OSD_TYPE`'s kind of field: written when chosen,
 * then a quiet re-read, which is where the frame rows here and the whole VTOL
 * half of Tuning and Filters come from.
 *
 * This comment used to say the tree was built only at boot, so the field was
 * staged and relied on the restart prompt. Written that way the vehicle had
 * a quadplane and the app did not know it until somebody reloaded the
 * parameters by hand.
 */
function VtolCard() {
  const qEnable = useParamStore((s) => s.entries.get('Q_ENABLE')?.value)
  const qClass = useParamStore((s) => s.entries.get('Q_FRAME_CLASS')?.value)
  const qType = useParamStore((s) => s.entries.get('Q_FRAME_TYPE')?.value)
  const classNames = useParamStore((s) => s.metadata['Q_FRAME_CLASS']?.values)
  const typeNames = useParamStore((s) => s.metadata['Q_FRAME_TYPE']?.values)
  if (qEnable === undefined) return null

  // A quadplane's lift motors run AP_MotorsMatrix, the same library and the
  // same switch a Copter's do, so an unsupported pairing fails the same way:
  // the setup returns false, the frame reports UNSUPPORTED, the motors never
  // initialise and the aircraft will not arm. ArduPlane offers a narrower
  // class list than Copter -- no helicopters, no bicopter, plus Single/Dual
  // and the scripting matrices -- and every class it offers that this app can
  // draw is already in the table, so nothing about it needs a plane-specific
  // case.
  const tile =
    qClass !== undefined && qType !== undefined
      ? frameTiles(qType).find((t) => t.frameClass === qClass)
      : undefined
  const naming =
    qClass === undefined || qType === undefined
      ? ''
      : `${classNames?.[qClass] ?? FRAME_CLASS_NAMES[qClass] ?? `class ${qClass}`} ` +
        `${typeNames?.[qType] ?? `type ${qType}`}`

  return (
    // A plain card rather than a `ParamCard`, for the same reason the Copter
    // frame is one: the picture is not a field, and a list of parameter rows
    // has nowhere beside itself to put it.
    <LaCard
      title="VTOL"
      className="vtol-card"
      actions={
        <>
          {tile?.supported === false && (
            <span
              className="card-status card-status--bad"
              role="status"
              title={`ArduPilot has no ${naming} layout, so the vehicle will not start its lift motors.`}
            >
              {/* One word, because the pairing it would name is in the two
                  dropdowns directly below. Spelling it out here cost the
                  status its own room -- a title row holding a name, a status
                  and two buttons in one grid track truncated it to
                  "Unsupported: Qu..." -- and the row cannot wrap, since a card
                  that changes height when a status appears is the thing this
                  screen's layout is built to avoid. */}
              Unsupported
            </span>
          )}
          <CardParamActions
            reason="VTOL changes take effect after a restart"
            owns={(param) => param === 'Q_ENABLE' || param.startsWith('Q_FRAME')}
          />
        </>
      }
    >
      {/* Beside the fields rather than under them: stacked, the picture pushed
          the card to twice the height of its three rows and left the whole
          right half of it empty, on a screen whose whole shape is a column of
          cards against one tall neighbour. */}
      <div className="vtol-card__body">
        {/* All three rows always, the frame pair greyed until the firmware
            reports it. They exist only once Q_ENABLE is on *and* the vehicle
            has restarted, so rendering them conditionally made the card two
            rows shorter on a fixed wing and grew it under the reader the
            moment a reboot came back -- on a screen whose left column is
            height-matched to the tune card beside it. */}
        <div className="vtol-card__fields">
          <ParamField param="Q_ENABLE" label="Enable VTOL" showName writeNow gatesOthers />
          <ParamField
            param="Q_FRAME_CLASS"
            label="Frame class"
            showName
            {...(qClass === undefined ? { disabled: true } : {})}
          />
          <ParamField
            param="Q_FRAME_TYPE"
            label="Frame type"
            showName
            {...(qType === undefined ? { disabled: true } : {})}
          />
        </div>
        {/* One picture of what is selected, not the Copter screen's table of
            every class. The table is a picker made of pictures, which earns
            its height where the frame is the whole aircraft; here it is the
            lift system under an airframe nothing else on this page
            describes. */}
        {tile && <FrameDiagram motors={tile.motors} className="vtol-card__art" />}
      </div>
    </LaCard>
  )
}

/**
 * The speeds the whole fixed-wing controller is built around.
 *
 * This is the plane's answer to the Copter screen's Initial tune, and it is
 * deliberately fields rather than a calculator: ArduPilot publishes anchors
 * for propeller diameter that make that card's arithmetic its own rather than
 * ours, and nothing equivalent exists here. A cruise speed derived from a
 * wingspan would be this app inventing airmanship.
 *
 * The sensor sits at the head of the card because `ARSPD_USE` decides what
 * the three numbers below it even mean: with a pitot fitted and used they are
 * measured, and without one the controller synthesizes airspeed from GPS and
 * throttle and flies to the same targets with far less to go on.
 */
function AirspeedCard() {
  // Whether the pitot is used at all, which is what the rest of the card
  // hangs off: with it off the controller synthesizes airspeed from GPS and
  // throttle, and which sensor is wired up stops meaning anything -- so the
  // type is greyed rather than removed. ArduPilot's own values are
  // 0 Don't use, 1 Use, 2 Use when throttle is zero, so "not zero" is the
  // test rather than "is one".
  const use = useParamStore((s) => s.entries.get('ARSPD_USE')?.value)
  return (
    <ParamCard
      title="Airspeed"
      showNames
      actions={
        <CardParamActions
          reason="Airspeed changes take effect after a restart"
          owns={(param) => AIRSPEED_PARAMS.has(param)}
        />
      }
      fields={[
        { param: 'ARSPD_USE', label: 'Enable airspeed sensor' },
        { param: 'ARSPD_TYPE', label: 'Sensor type', ...(use === 0 ? { disabled: true } : {}) },
        // No unit written here: the metadata gives each its own, so the page
        // is right for whatever a release says, as Power and Failsafe are.
        { param: 'AIRSPEED_MIN', label: 'Minimum airspeed' },
        { param: 'AIRSPEED_CRUISE', label: 'Cruise airspeed' },
        { param: 'AIRSPEED_MAX', label: 'Maximum airspeed' },
        { param: 'AIRSPEED_STALL', label: 'Stall airspeed' },
        // The throttle that holds the cruise speed above, which is why it
        // reads here rather than among the attitude limits.
        { param: 'TRIM_THROTTLE', label: 'Cruise throttle' },
      ]}
    />
  )
}

const AIRSPEED_PARAMS: ReadonlySet<string> = new Set([
  'ARSPD_TYPE',
  'ARSPD_USE',
  'AIRSPEED_MIN',
  'AIRSPEED_CRUISE',
  'AIRSPEED_MAX',
  'AIRSPEED_STALL',
  'TRIM_THROTTLE',
])

/**
 * The plane half of the Configuration screen: one column, read downward.
 *
 * A column rather than cards loose in the page grid, because these are one
 * subject in two parts -- how fast this aircraft flies, and what if anything
 * lifts it vertically -- and the grid would otherwise spread them across the
 * window in whatever order fits, with the VTOL tune landing wherever there
 * was room. Stacked, the tune stands in the next column and appears only when
 * there are motors to tune.
 */
export default function PlaneCards() {
  return (
    <div className="app-stack app-stack--fill">
      <AirspeedCard />
      <VtolCard />
    </div>
  )
}
