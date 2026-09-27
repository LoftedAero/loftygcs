import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// What the vehicle does when something goes wrong. Battery failsafe actions
// live on the Power tab, next to the thresholds that trigger them.
//
// Copter, Plane and quadplane name these parameters differently (names taken
// from 4.7.1 vehicles of each kind). Each card covers one subject on every
// vehicle (radio loss, GCS loss, return, EKF, fence, arming) and lists
// whichever of its parameters the vehicle reports. Only VTOL assist is
// quadplane-specific.
//
// 4.7 renamed Copter's RTL_ALT, RTL_ALT_FINAL and RTL_CLIMB_MIN to *_M
// variants in meters instead of centimeters, and replaced ARMING_CHECK with
// ARMING_SKIPCHK, which lists checks to skip. Older spellings are listed after
// the current ones. Units come from the metadata, except the two throttle PWM
// values, which Plane's metadata leaves unitless.
//
// Plane-specific: FS_GCS_ENABL (no E), FS_SHORT_ACTN and FS_LONG_ACTN for
// radio failsafe, and CRASH_DETECT. FS_SHORT_TIMEOUT is gone in 4.7.
const REASON = 'Failsafe changes take effect after a restart'

/** One field per spelling, newest first; the card keeps whichever is reported. */
function both(names: string[], label: string, unit?: string): ParamFieldSpec[] {
  return names.map((param) => ({ param, label, ...(unit ? { unit } : {}) }))
}

function card(title: string, fields: ParamFieldSpec[]) {
  const names = new Set(fields.map((f) => f.param))
  return (
    <ParamCard
      key={title}
      title={title}
      showNames
      // Three columns leave about 12 characters per control.
      compact
      fields={fields}
      actions={<CardParamActions reason={REASON} owns={(p) => names.has(p)} />}
    />
  )
}

const RADIO: ParamFieldSpec[] = [
  { param: 'FS_THR_ENABLE', label: 'Throttle failsafe' },
  { param: 'THR_FAILSAFE', label: 'Throttle failsafe' },
  { param: 'FS_THR_VALUE', label: 'Trigger PWM', unit: 'µs' },
  { param: 'THR_FS_VALUE', label: 'Trigger PWM', unit: 'µs' },
  // Plane's two stages: what it does at once, and after the long timeout.
  { param: 'FS_SHORT_ACTN', label: 'Short action' },
  { param: 'FS_LONG_ACTN', label: 'Long action' },
  { param: 'FS_LONG_TIMEOUT', label: 'Long after' },
  { param: 'FS_OPTIONS', label: 'Options' },
]

// On a typical telemetry link this fires on ordinary dropouts. Plane times it
// with FS_LONG_TIMEOUT, on the radio card.
const GCS: ParamFieldSpec[] = [
  ...both(['FS_GCS_ENABLE', 'FS_GCS_ENABL'], 'GCS failsafe'),
  { param: 'FS_GCS_TIMEOUT', label: 'Timeout' },
]

// A quadplane's VTOL return settings are rows here, not a separate card.
const RTL: ParamFieldSpec[] = [
  ...both(['RTL_ALT_M', 'RTL_ALT'], 'RTL altitude'),
  { param: 'RTL_ALTITUDE', label: 'RTL altitude' },
  ...both(['RTL_ALT_FINAL_M', 'RTL_ALT_FINAL'], 'Final altitude'),
  ...both(['RTL_CLIMB_MIN_M', 'RTL_CLIMB_MIN'], 'Minimum climb'),
  { param: 'RTL_LOIT_TIME', label: 'Loiter before descent' },
  { param: 'RTL_SPEED_MS', label: 'Speed' },
  { param: 'RTL_CONE_SLOPE', label: 'Cone slope' },
  { param: 'RTL_RADIUS', label: 'Loiter radius' },
  { param: 'RTL_AUTOLAND', label: 'Auto land' },
  { param: 'Q_RTL_MODE', label: 'VTOL RTL mode' },
  { param: 'Q_RTL_ALT', label: 'VTOL RTL altitude' },
]

const ESTIMATOR: ParamFieldSpec[] = [
  { param: 'FS_EKF_ACTION', label: 'EKF failsafe action' },
  { param: 'FS_EKF_THRESH', label: 'EKF threshold' },
  { param: 'FS_CRASH_CHECK', label: 'Crash check' },
  { param: 'CRASH_DETECT', label: 'Crash detection' },
  { param: 'CRASH_ACC_THRESH', label: 'Crash threshold' },
  { param: 'FS_VIBE_ENABLE', label: 'Vibration failsafe' },
  { param: 'FS_DR_ENABLE', label: 'Dead reckoning' },
  { param: 'FS_DR_TIMEOUT', label: 'Dead reckoning timeout' },
]

const FENCE: ParamFieldSpec[] = [
  { param: 'FENCE_ENABLE', label: 'Fence' },
  { param: 'FENCE_AUTOENABLE', label: 'Auto-enable' },
  { param: 'FENCE_TYPE', label: 'Fence type' },
  { param: 'FENCE_ACTION', label: 'Breach action' },
  { param: 'FENCE_ALT_MAX', label: 'Maximum altitude' },
  { param: 'FENCE_ALT_MIN', label: 'Minimum altitude' },
  { param: 'FENCE_RADIUS', label: 'Radius' },
  { param: 'FENCE_MARGIN', label: 'Margin' },
  { param: 'FENCE_RET_ALT', label: 'Return altitude' },
  { param: 'FENCE_RET_RALLY', label: 'Return to rally' },
]

// 4.7 inverted the mask: ARMING_SKIPCHK lists checks to skip.
const ARMING: ParamFieldSpec[] = [
  { param: 'ARMING_SKIPCHK', label: 'Checks skipped' },
  { param: 'ARMING_CHECK', label: 'Checks enabled' },
  { param: 'ARMING_REQUIRE', label: 'Require arming' },
  { param: 'ARMING_RUDDER', label: 'Rudder arming' },
  { param: 'DISARM_DELAY', label: 'Auto-disarm delay' },
]

// Quadplane only: VTOL motors assisting a fixed-wing flight that is losing
// speed, height or attitude, and the action when a transition fails.
const VTOL: ParamFieldSpec[] = [
  { param: 'Q_ASSIST_SPEED', label: 'Assist below speed' },
  { param: 'Q_ASSIST_ALT', label: 'Assist below altitude' },
  { param: 'Q_ASSIST_ANGLE', label: 'Assist beyond angle' },
  { param: 'Q_ASSIST_DELAY', label: 'Assist delay' },
  { param: 'Q_TRANS_FAIL', label: 'Transition timeout' },
  { param: 'Q_TRANS_FAIL_ACT', label: 'Transition failure' },
]

export default function FailsafesTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  if (!connected || !ready) {
    return <NeedsVehicle title="Failsafes" />
  }

  // Each card is in the same column on every vehicle.
  return (
    <div className="config-screen config-screen--even">
      <div className="app-stack app-stack--fill">
        {card('Arming', ARMING)}
        {card('Radio failsafe', RADIO)}
        {card('Ground station failsafe', GCS)}
        {card('Return to launch', RTL)}
      </div>
      <div className="app-stack app-stack--fill">
        {card('Fence', FENCE)}
        {card('EKF and crash', ESTIMATOR)}
        {card('VTOL assist', VTOL)}
      </div>
    </div>
  )
}
