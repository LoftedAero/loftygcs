import { LaButton, LaModal } from '../components/La'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useParamStore } from '../../stores/param-store'
import { useUiStore } from '../../stores/ui-store'
import PopupWindow from '../components/PopupWindow'
import { isNativeApp } from '../../env'
import { SENSOR_BITS, type SensorId } from '../../protocol/sensors'
import {
  coreImus,
  estimatorIndicator,
  estimatorName,
  EKF_FLAGS,
  FALLBACK_ESTIMATOR,
  FLAG_DEFS,
  isEstimatorMessage,
  isFailsafeState,
  VARIANCES,
} from '../../protocol/estimator'
import { gpsKind } from '../tabs/flight/hud-draw'

// What the app bar's estimator button is built from, all of it, live: which
// estimator is in charge and how it was decided, the EKF's own variances and
// solution flags, the sensors feeding it, and what it has said lately. It
// shows; nothing here edits.
//
// A window of its own, so it can be kept on another screen while flying. The
// Android app has one window, and a blocked popup has none, so there it is a
// floating dialog instead, which blocks nothing behind it.

/** The window's opening size, measured to show everything without scrolling. */
const WINDOW_W = 900
const WINDOW_H = 700

/** Mounted only while open, since the window follows the whole status feed. */
export default function EstimatorWindow() {
  const open = useUiStore((s) => s.estimatorOpen)
  const setOpen = useUiStore((s) => s.setEstimatorOpen)
  if (!open) return null
  const close = () => setOpen(false)
  const dialog = (
    <LaModal
      open
      floating
      title="EKF status"
      actions={
        <LaButton variant="primary" onClick={close}>
          Close
        </LaButton>
      }
    >
      <EstimatorPanel />
    </LaModal>
  )
  if (isNativeApp()) return dialog
  return (
    <PopupWindow
      name="ekf"
      title="EKF status"
      width={WINDOW_W}
      height={WINDOW_H}
      onClose={close}
      fallback={dialog}
    >
      <EstimatorPanel />
    </PopupWindow>
  )
}

const MAV_TYPE_FIXED_WING = 1

/** The sensors an estimator is built on, in the order a pilot checks them. */
const ESTIMATOR_SENSORS: readonly { id: SensorId; label: string; always?: boolean }[] = [
  { id: 'ahrs', label: 'AHRS', always: true },
  { id: 'gyro', label: 'Gyroscope', always: true },
  { id: 'gyro2', label: 'Gyroscope 2' },
  { id: 'accel', label: 'Accelerometer', always: true },
  { id: 'accel2', label: 'Accelerometer 2' },
  { id: 'mag', label: 'Compass', always: true },
  { id: 'mag2', label: 'Compass 2' },
  { id: 'baro', label: 'Barometer', always: true },
  { id: 'gps', label: 'GPS', always: true },
  { id: 'airspeed', label: 'Airspeed' },
  { id: 'rangefinder', label: 'Rangefinder' },
  { id: 'opticalFlow', label: 'Optical flow' },
]

/** How many of the estimator's messages the history keeps on screen. */
const MESSAGE_ROWS = 6

type Tone = 'ok' | 'warn' | 'bad' | 'none'

function EstimatorPanel() {
  const present = useVehicleStore((s) => s.sensorsPresent)
  const enabled = useVehicleStore((s) => s.sensorsEnabled)
  const health = useVehicleStore((s) => s.sensorsHealth)
  const ekf = useVehicleStore((s) => s.ekf)
  const announced = useVehicleStore((s) => s.estimatorAnnounced)
  const switchedCore = useVehicleStore((s) => s.ekfPrimaryCore)
  const gpsFix = useVehicleStore((s) => s.gpsFix)
  const gpsSats = useVehicleStore((s) => s.gpsSats)
  const gpsHdop = useVehicleStore((s) => s.gpsHdop)
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const ekfFailsafe = useVehicleStore((s) => s.ekfFailsafe && isFailsafeState(s.systemStatus))
  const param = (name: string) => useParamStore.getState().entries.get(name)?.value
  // Subscribed so the window follows a parameter download or edit.
  useParamStore((s) => s.entries)

  const ahrsEkfType = param('AHRS_EKF_TYPE')
  const configured = estimatorName(ahrsEkfType)
  const indicator = estimatorIndicator({
    ahrsEkfType,
    sensorsPresent: present,
    sensorsHealth: health,
    ahrsBit: SENSOR_BITS.ahrs,
    ekf,
    announced,
    ekfFailsafe,
  })
  const isEkf = configured === 'EKF3' || configured === 'EKF2'
  const imus = coreImus(param(configured === 'EKF2' ? 'EK2_IMU_MASK' : 'EK3_IMU_MASK'))
  const primary = switchedCore ?? (configured === 'EKF3' ? param('EK3_PRIMARY') : undefined)
  const primaryImu = primary !== undefined ? imus[primary] : undefined
  const thresh = param('FS_EKF_THRESH')
  const threshold = thresh !== undefined && thresh > 0 ? thresh : null

  const flags = ekf?.flags ?? 0
  // A variance only means something while its sensor is in use: terrain needs
  // a height-above-ground solution, airspeed an airspeed sensor.
  const varianceInUse = (key: string) =>
    key === 'terrainAltVariance'
      ? (flags & EKF_FLAGS.posVertAgl) !== 0
      : key === 'airspeedVariance'
        ? (present & SENSOR_BITS.airspeed) !== 0
        : true
  const showAirspeed = vehicleType === MAV_TYPE_FIXED_WING || (present & SENSOR_BITS.airspeed) !== 0
  // The bars run to a little past the failsafe line, so it sits in view.
  const scale = Math.max(1, (threshold ?? 0) * 1.25)

  const sensors = ESTIMATOR_SENSORS.filter(
    (s) => s.always || (present & SENSOR_BITS[s.id]) !== 0,
  ).map((s) => {
    const bit = SENSOR_BITS[s.id]
    const state: Tone = !(present & bit)
      ? 'none'
      : !(enabled & bit)
        ? 'none'
        : health & bit
          ? 'ok'
          : 'bad'
    const word = !(present & bit)
      ? '-'
      : !(enabled & bit)
        ? 'Disabled'
        : health & bit
          ? 'Healthy'
          : 'Unhealthy'
    // The fix and satellite count fit the row; HDOP rides in the hover text.
    const gps = s.id === 'gps' && (present & bit) !== 0
    const detail = gps
      ? [gpsKind(gpsFix), gpsSats > 0 ? `${gpsSats} sats` : ''].filter(Boolean).join(' · ')
      : ''
    const hover = gps && gpsHdop > 0 ? `${detail} · HDOP ${gpsHdop.toFixed(1)}` : undefined
    return { ...s, state, word, detail, hover }
  })

  const messages = statusTexts.filter((t) => isEstimatorMessage(t.text)).slice(-MESSAGE_ROWS)

  return (
    <div className="estimator">
      <div className="estimator__summary">
        <span className={`estimator__pill estimator__pill--${indicator.tone}`}>
          <span className="estimator__dot" aria-hidden="true" />
          {indicator.label}
        </span>
        <dl className="estimator__facts">
          <div>
            <dt>Configured</dt>
            <dd>{ahrsEkfType === undefined ? '-' : configured}</dd>
          </div>
          <div>
            <dt>Cores</dt>
            <dd>{isEkf && imus.length > 0 ? imus.length : '-'}</dd>
          </div>
          <div>
            <dt>Primary</dt>
            <dd>{isEkf && primaryImu !== undefined ? `IMU${primaryImu}` : '-'}</dd>
          </div>
          <div>
            <dt>Fallback</dt>
            <dd>{isEkf ? FALLBACK_ESTIMATOR : '-'}</dd>
          </div>
          <div className={ekfFailsafe ? 'estimator__fact--bad' : undefined}>
            <dt>Failsafe</dt>
            <dd>{ekfFailsafe ? 'EKF' : '-'}</dd>
          </div>
        </dl>
      </div>

      <div className="estimator__columns">
        <section>
          <h4 className="estimator__head">Variances</h4>
          <ul className="estimator__variances">
            {VARIANCES.filter((v) => v.key !== 'airspeedVariance' || showAirspeed).map((v) => {
              const value = ekf && varianceInUse(v.key) ? ekf[v.key] : null
              const tone: Tone =
                value === null ? 'none' : threshold !== null && value >= threshold ? 'bad' : 'ok'
              return (
                <li key={v.key} className={`estimator__variance estimator__variance--${tone}`}>
                  <span className="estimator__label">{v.label}</span>
                  <span className="estimator__bar">
                    <span
                      className="estimator__fill"
                      style={{ width: `${Math.min(1, (value ?? 0) / scale) * 100}%` }}
                    />
                    {threshold !== null && (
                      <span
                        className="estimator__limit"
                        style={{ left: `${(threshold / scale) * 100}%` }}
                        title={`FS_EKF_THRESH ${threshold}`}
                      />
                    )}
                  </span>
                  <span className="estimator__value">
                    {value === null ? '-' : value.toFixed(2)}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h4 className="estimator__head">Sensors</h4>
          <ul className="estimator__sensors">
            {sensors.map((s) => (
              <li
                key={s.id}
                className={`estimator__sensor estimator__sensor--${s.state}`}
                title={s.hover}
              >
                <span className="estimator__dot" aria-hidden="true" />
                <span className="estimator__label">{s.label}</span>
                <span className="estimator__detail">{s.detail}</span>
                <span className="estimator__word">{s.word}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h4 className="estimator__head">Solution</h4>
        <ul className="estimator__flags">
          {FLAG_DEFS.map((f) => {
            const on = ekf !== null && (flags & f.bit) !== 0
            return (
              <li key={f.bit} className={`estimator__flag estimator__flag--${on ? f.kind : 'off'}`}>
                <span className="estimator__dot" aria-hidden="true" />
                {f.label}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h4 className="estimator__head">Messages</h4>
        <div className="la-log estimator__log">
          {messages.length === 0
            ? '-'
            : messages.map((m, i) => <div key={`${m.at}-${i}`}>{m.text}</div>)}
        </div>
      </section>
    </div>
  )
}
