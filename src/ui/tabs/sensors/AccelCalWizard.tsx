import { useEffect, useRef, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { connectionService } from '../../../services/connection'
import { MAV_RESULT } from '../../../protocol/commands'
import {
  ACCEL_POSITIONS,
  isCalibrationFailure,
  isCalibrationSuccess,
  parseAccelPrompt,
  type AccelPosition,
  type AccelPositionId,
} from '../../../protocol/accel-cal'
import AccelVehicleView from './AccelVehicleView'
import { useParamStore } from '../../../stores/param-store'

const MAV_CMD_PREFLIGHT_CALIBRATION = 241
const MAV_CMD_ACCELCAL_VEHICLE_POS = 42429

type Stage = 'confirm' | 'running' | 'done' | 'failed'

/**
 * Accelerometer calibration, following QGroundControl's shape: the vehicle
 * says which side it wants, we show that instruction with the airframe
 * drawn in that attitude, and one button captures the position.
 *
 * The sequence is the vehicle's to decide -- we react to its STATUSTEXT
 * prompts rather than marching through a list of our own, so a retried or
 * reordered side still tracks correctly.
 */
export default function AccelCalWizard({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess?: () => void
}) {
  const [stage, setStage] = useState<Stage>('confirm')
  const [current, setCurrent] = useState<AccelPosition | null>(null)
  const [completed, setCompleted] = useState<AccelPositionId[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [simple, setSimple] = useState(false)
  const [orientationBusy, setOrientationBusy] = useState(false)
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const orientation = useParamStore((s) => s.entries.get('AHRS_ORIENTATION'))
  const orientationMeta = useParamStore((s) => s.metadata['AHRS_ORIENTATION'])
  const seenUpTo = useRef(0)

  // Follow the vehicle: every new status line either asks for a side or
  // reports the verdict.
  useEffect(() => {
    if (stage !== 'running') return
    const fresh = statusTexts.slice(seenUpTo.current)
    if (fresh.length === 0) return
    seenUpTo.current = statusTexts.length

    for (const line of fresh) {
      if (isCalibrationSuccess(line.text)) {
        setCompleted(ACCEL_POSITIONS.map((p) => p.id))
        setCurrent(null)
        setPrompt(line.text)
        setStage('done')
        onSuccess?.()
        return
      }
      if (isCalibrationFailure(line.text)) {
        setPrompt(line.text)
        setStage('failed')
        return
      }
      const asked = parseAccelPrompt(line.text)
      if (asked) {
        setPrompt(line.text)
        setCapturing(false)
        setCurrent((previous) => {
          // A new side means the previous one was accepted.
          if (previous && previous.id !== asked.id) {
            setCompleted((done) => (done.includes(previous.id) ? done : [...done, previous.id]))
          }
          return asked
        })
      }
    }
  }, [stage, statusTexts, onSuccess])

  const start = async () => {
    setError('')
    setCompleted([])
    setCurrent(null)
    setPrompt('')
    seenUpTo.current = useVehicleStore.getState().statusTexts.length
    setStage('running')
    try {
      // param5 = 1 walks the six sides; 4 is ArduPilot's simple calibration,
      // which trims from the level position alone.
      const result = await connectionService.runCommand(
        MAV_CMD_PREFLIGHT_CALIBRATION,
        [0, 0, 0, 0, simple ? 4 : 1, 0, 0],
        5000,
      )
      if (result !== 0) {
        setStage('confirm')
        setError(`The vehicle refused to start: ${MAV_RESULT[result] ?? result}. Disarm first.`)
      }
    } catch (err) {
      setStage('confirm')
      setError(err instanceof Error ? err.message : 'could not start calibration')
    }
  }

  const capture = async () => {
    if (!current) return
    setCapturing(true)
    setError('')
    try {
      await connectionService.runCommand(MAV_CMD_ACCELCAL_VEHICLE_POS, [current.value], 5000)
    } catch (err) {
      setCapturing(false)
      setError(err instanceof Error ? err.message : 'the vehicle did not answer')
    }
  }

  const cancel = () => {
    // Nothing to cancel on the vehicle side: accel calibration ends on its
    // own once it stops being fed positions.
    onClose()
  }

  return (
    <LaModal
      open
      title="Accelerometer calibration"
      actions={
        <>
          {(stage === 'confirm' || stage === 'running') && (
            <LaButton variant="ghost" onClick={cancel}>
              Cancel
            </LaButton>
          )}
          {stage === 'confirm' && (
            <LaButton variant="primary" onClick={() => void start()}>
              Start
            </LaButton>
          )}
          {stage === 'running' && (
            <LaButton
              variant="primary"
              disabled={!current || capturing}
              onClick={() => void capture()}
            >
              {capturing ? 'Capturing…' : 'Next'}
            </LaButton>
          )}
          {(stage === 'done' || stage === 'failed') && (
            <LaButton variant="primary" onClick={onClose}>
              Close
            </LaButton>
          )}
        </>
      }
    >
      {stage === 'confirm' && (
        <>
          <p className="accel-note">
            Check the autopilot rotation before calibrating. If the board is mounted facing the
            direction of flight, leave it at None — calibrating around a wrong orientation bakes
            the error into the offsets.
          </p>
          <div className="la-field">
            <label className="la-field__label" htmlFor="accel-orientation">
              Autopilot rotation
            </label>
            {orientation ? (
              <select
                id="accel-orientation"
                className="la-select"
                disabled={orientationBusy}
                value={String(orientation.value)}
                onChange={(e) => {
                  // Written straight through rather than staged: it has to be
                  // right on the vehicle before calibration starts, and a
                  // pending edit sitting in the Write Params queue would not be.
                  const next = Number(e.target.value)
                  setOrientationBusy(true)
                  setError('')
                  void connectionService
                    .setParamNow('AHRS_ORIENTATION', next)
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : 'could not set autopilot rotation',
                      ),
                    )
                    .finally(() => setOrientationBusy(false))
                }}
              >
                {orientationMeta?.values ? (
                  Object.entries(orientationMeta.values).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))
                ) : (
                  <option value={String(orientation.value)}>{orientation.value}</option>
                )}
              </select>
            ) : (
              <span className="la-muted">not reported by this vehicle</span>
            )}
          </div>

          <p className="accel-note">
            Simple calibration is less precise but does not need the vehicle turned over. Use it
            for an airframe too large or heavy to handle.
          </p>
          <label className="la-switch accel-switch">
            <span className="la-field__unit">Simple accelerometer calibration</span>
            <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} />
            <span className="la-switch__track"></span>
          </label>

          <p className="guide-step__body">
            {simple
              ? 'The vehicle will trim from the level position alone. Set it down level before starting.'
              : 'The vehicle will ask for six orientations in turn, a few seconds each. Keep USB connected and have room to turn the airframe over.'}
          </p>
        </>
      )}

      {stage !== 'confirm' && (
        <>
          <ol className="accel-rail">
            {ACCEL_POSITIONS.map((p) => {
              const done = completed.includes(p.id)
              const active = current?.id === p.id
              return (
                <li
                  key={p.id}
                  className={[
                    'accel-rail__item',
                    done ? 'accel-rail__item--done' : '',
                    active ? 'accel-rail__item--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={done ? `${p.label}: captured` : active ? `${p.label}: hold now` : p.label}
                >
                  <span className="accel-rail__dot">{done ? '✓' : ''}</span>
                  {p.label}
                </li>
              )
            })}
          </ol>

          <div className="accel-stage">
            <AccelVehicleView position={current?.id ?? 'LEVEL'} />
            <div className="accel-stage__text">
              {stage === 'running' && current && (
                <>
                  <p className="accel-stage__instruction">{current.instruction}</p>
                  <p className="accel-stage__prompt">{prompt}</p>
                  <p className="la-muted">Hold it still, then press Next.</p>
                </>
              )}
              {stage === 'running' && !current && (
                <p className="accel-stage__prompt">
                  {simple
                    ? 'Hold the vehicle level and still while it calibrates…'
                    : 'Waiting for the vehicle…'}
                </p>
              )}
              {stage === 'done' && (
                <p className="accel-stage__instruction">
                  Calibration successful. The offsets are saved on the vehicle.
                </p>
              )}
              {stage === 'failed' && (
                <>
                  <p className="accel-stage__instruction">Calibration failed.</p>
                  <p className="accel-stage__prompt">{prompt}</p>
                  <p className="la-muted">
                    Usually the airframe moved, or a side was not held square. Run it again.
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <LaHint error>{error}</LaHint>
    </LaModal>
  )
}
