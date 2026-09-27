import { LaCard } from '../../components/La'
import ParamCard from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import CardParamActions from '../../components/CardParamActions'
import FrameDiagram from './FrameDiagram'
import { useParamStore } from '../../../stores/param-store'
import { FRAME_CLASS_NAMES, frameTiles } from '../../../protocol/frame-layout'

// The Configuration screen for a fixed wing. ArduPlane has no FRAME_CLASS,
// FRAME_TYPE or MOT_* parameters, so this covers the airspeeds the aircraft
// flies at and whether it has VTOL motors. Lean limits are on Tuning's
// Attitude card.
//
// Parameter names are the 4.4+ spellings. The pre-4.4 names (`TRIM_ARSPD_CM`,
// `ARSPD_FBW_MIN/MAX`) are not offered as fallbacks, because they differ in
// unit (cm/s against m/s), not just spelling.

/**
 * Whether this aircraft has VTOL motors, and their arrangement.
 *
 * `Q_ENABLE` is the only `Q_` parameter a fixed wing reports. Setting it to 1
 * creates all the `Q_FRAME_*`, `Q_M_*` and `Q_A_*` parameters immediately,
 * without a restart (ArduPlane 4.7.1 goes from 1,419 to 1,619 parameters), so
 * it is written at once and followed by a quiet re-read.
 */
function VtolCard() {
  const qEnable = useParamStore((s) => s.entries.get('Q_ENABLE')?.value)
  const qClass = useParamStore((s) => s.entries.get('Q_FRAME_CLASS')?.value)
  const qType = useParamStore((s) => s.entries.get('Q_FRAME_TYPE')?.value)
  const classNames = useParamStore((s) => s.metadata['Q_FRAME_CLASS']?.values)
  const typeNames = useParamStore((s) => s.metadata['Q_FRAME_TYPE']?.values)
  if (qEnable === undefined) return null

  // Quadplane lift motors use AP_MotorsMatrix like a Copter, so the same
  // frame table applies: an unsupported class/type pairing leaves the motors
  // uninitialized and the aircraft will not arm.
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
    // A plain card rather than a `ParamCard`, to hold the frame picture.
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
              {/* One word: the pairing is in the dropdowns below, and the
                  title row has no room for more. */}
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
      {/* The picture sits beside the fields to keep the card short. */}
      <div className="vtol-card__body">
        {/* All three rows always render, the frame pair greyed until the
            firmware reports it, so the card height does not change. */}
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
        {/* Only the selected frame, not the Copter screen's full table. */}
        {tile && <FrameDiagram motors={tile.motors} className="vtol-card__art" />}
      </div>
    </LaCard>
  )
}

/**
 * The speeds the fixed-wing controller is built around. Plain fields rather
 * than a calculator like the Copter's Initial tune, since ArduPilot publishes
 * no equivalent formula for planes.
 *
 * The sensor comes first because `ARSPD_USE` decides whether the speeds are
 * measured or synthesized from GPS and throttle.
 */
function AirspeedCard() {
  // ARSPD_USE: 0 Don't use, 1 Use, 2 Use when throttle is zero. When 0 the
  // sensor type does not matter, so it is greyed.
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
        // Units come from the metadata for the running release.
        { param: 'AIRSPEED_MIN', label: 'Minimum airspeed' },
        { param: 'AIRSPEED_CRUISE', label: 'Cruise airspeed' },
        { param: 'AIRSPEED_MAX', label: 'Maximum airspeed' },
        { param: 'AIRSPEED_STALL', label: 'Stall airspeed' },
        // The throttle that holds the cruise speed.
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
 * The plane half of the Configuration screen, stacked in one column so the
 * page grid keeps the two cards together.
 */
export default function PlaneCards() {
  return (
    <div className="app-stack app-stack--fill">
      <AirspeedCard />
      <VtolCard />
    </div>
  )
}
