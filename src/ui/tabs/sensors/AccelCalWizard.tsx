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
  posePrompt,
  type AccelPosition,
  type AccelPositionId,
} from '../../../protocol/accel-cal'
import { useCalStore } from '../../../stores/cal-store'
import AttitudeTiles, { type AttitudeTile } from './AttitudeTiles'
import type { OrientationId } from '../../../protocol/cal-orientation'

const MAV_CMD_PREFLIGHT_CALIBRATION = 241
const MAV_CMD_ACCELCAL_VEHICLE_POS = 42429

/**
 * Which picture each side is. The accel and compass calibrations name the
 * same six attitudes differently, so the mapping is explicit rather than
 * relying on list order.
 */
const FRAME: Record<AccelPositionId, OrientationId> = {
  LEVEL: 'level',
  LEFT: 'leftSide',
  RIGHT: 'rightSide',
  NOSEDOWN: 'noseDown',
  NOSEUP: 'tailDown',
  BACK: 'upsideDown',
}

type Stage = 'running' | 'done' | 'failed' | 'refused'

/**
 * Accelerometer calibration, following QGroundControl's shape: the vehicle
 * says which side it wants, we show it, and one button captures the position.
 * The vehicle decides the sequence, so a retried side still tracks correctly.
 * The run starts as soon as the dialog opens.
 */
export default function AccelCalWizard({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess?: () => void
}) {
  const [stage, setStage] = useState<Stage>('running')
  const [current, setCurrent] = useState<AccelPosition | null>(null)
  const [completed, setCompleted] = useState<AccelPositionId[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const asked = useCalStore((s) => s.accelAsked)
  const seenUpTo = useRef(0)
  /** StrictMode mounts effects twice, and this one commands the vehicle. */
  const started = useRef(false)
  /** The side on screen, so the two sources of it cannot fight. */
  const sideRef = useRef<AccelPositionId | null>(null)
  /** When this dialog asked for a run, so an older request is not obeyed. */
  const startedAt = useRef(0)

  /**
   * Show a side, from whichever source reports it first: the vehicle's
   * repeated request or its printed line, which arrive in either order. The
   * previous side is read from a ref so this stays plain state updates.
   */
  const goTo = (position: AccelPosition, text: string) => {
    if (sideRef.current === position.id) {
      // Same side, said again: only the wording can be new.
      if (text) setPrompt(text)
      return
    }
    sideRef.current = position.id
    setCapturing(false)
    setCurrent(position)
    setPrompt(text)
    // ArduPilot walks the sides in order (`_step` only counts up), so every
    // side before this one is captured. That is how the tiles fill in when
    // rejoining a run already in progress.
    setCompleted(ACCEL_POSITIONS.filter((p) => p.value < position.value).map((p) => p.id))
  }

  useEffect(() => {
    // ArduPilot repeats MAV_CMD_ACCELCAL_VEHICLE_POS every second while it
    // waits, whereas the "Place vehicle..." text is printed once; following
    // the command lets this dialog rejoin a run it did not start (ArduPilot
    // has no MAVLink cancel). Only the six sides are read: the terminal
    // SUCCESS/FAILED values keep repeating after a run ends, so the verdict
    // comes from the status text instead. Requests older than this dialog's
    // start are ignored.
    if (stage !== 'running' || !asked || asked.at < startedAt.current) return
    const position = ACCEL_POSITIONS.find((p) => p.value === asked.position)
    if (position) goTo(position, '')
    // `goTo` is recreated every render and deliberately not a dependency.
  }, [stage, asked])

  // The status text carries the verdict and the firmware's wording of the pose.
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
      const said = parseAccelPrompt(line.text)
      if (said) {
        // Fallback for a firmware that does not repeat the command, or a
        // link that loses it.
        goTo(said, line.text)
      }
    }
  }, [stage, statusTexts, onSuccess])

  const start = async () => {
    setError('')
    setCompleted([])
    setCurrent(null)
    setPrompt('')
    sideRef.current = null
    startedAt.current = Date.now()
    seenUpTo.current = useVehicleStore.getState().statusTexts.length
    setStage('running')
    try {
      // param5 = 1 walks the six sides.
      const result = await connectionService.runCommand(
        MAV_CMD_PREFLIGHT_CALIBRATION,
        [0, 0, 0, 0, 1, 0, 0],
        5000,
      )
      if (result !== 0) {
        setStage('refused')
        setError(`The vehicle refused to start: ${MAV_RESULT[result] ?? result}. Disarm first.`)
      }
    } catch (err) {
      setStage('refused')
      setError(err instanceof Error ? err.message : 'could not start calibration')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void start()
    // Once, on open. The ref guards against StrictMode's double mount, so
    // `start` is deliberately not a dependency.
  }, [])

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

  // No turn arrow or progress bar: each side is held still, and the vehicle
  // decides when it has enough.
  const tiles: AttitudeTile[] = ACCEL_POSITIONS.map((p) => ({
    id: FRAME[p.id],
    label: p.label,
    done: completed.includes(p.id),
    here: current?.id === p.id,
    spin: false,
    progress: null,
  }))

  const cancel = () => {
    // Nothing to send: ArduPilot has no MAVLink cancel for an accelerometer
    // calibration (`AP_AccelCal::cancel()` is only called on arming). A run
    // left part-way keeps waiting and ignores the next PREFLIGHT_CALIBRATION;
    // reopening this dialog rejoins it.
    onClose()
  }

  return (
    <LaModal
      open
      title="Accelerometer calibration"
      actions={
        <>
          {stage === 'running' && (
            <>
              <LaButton variant="ghost" onClick={cancel}>
                Cancel
              </LaButton>
              <LaButton
                variant="primary"
                disabled={!current || capturing}
                onClick={() => void capture()}
              >
                {capturing ? 'Capturing…' : 'Next'}
              </LaButton>
            </>
          )}
          {(stage === 'failed' || stage === 'refused') && (
            <LaButton variant="primary" onClick={() => void start()}>
              Try again
            </LaButton>
          )}
          {stage !== 'running' && (
            <LaButton
              variant={stage === 'failed' || stage === 'refused' ? 'ghost' : 'primary'}
              onClick={onClose}
            >
              Close
            </LaButton>
          )}
        </>
      }
    >
      {stage !== 'refused' && (
        <>
          {/* The same six pictures the compass calibration uses. */}
          <AttitudeTiles tiles={tiles} />

          {/* The vehicle's own words for the pose, with our instruction for
              what to press (the firmware says "press any key"). */}
          {stage === 'running' && current && (
            <p className="app-placeholder">
              {`${prompt ? posePrompt(prompt) : current.instruction.replace(/\.$/, '')}. Hold it still, then press Next.`}
            </p>
          )}
          {stage === 'running' && !current && (
            <p className="app-placeholder">Waiting for the vehicle…</p>
          )}
          {stage === 'done' && (
            <LaHint>Calibration successful. The offsets are saved on the vehicle.</LaHint>
          )}
          {stage === 'failed' && (
            <LaHint error>
              Calibration failed. Usually the airframe moved, or a side was not held square.
            </LaHint>
          )}
        </>
      )}

      <LaHint error>{error}</LaHint>
    </LaModal>
  )
}
