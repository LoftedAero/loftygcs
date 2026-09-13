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
 * Which picture each side is.
 *
 * The two calibrations name the same six attitudes differently -- ArduPilot's
 * accel positions are LEVEL/LEFT/RIGHT/NOSEDOWN/NOSEUP/BACK -- so the mapping
 * is written out rather than left to the two lists happening to be in the
 * same order, which they are today and need not stay.
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
 * says which side it wants, we show that instruction with the airframe
 * drawn in that attitude, and one button captures the position.
 *
 * The sequence is the vehicle's to decide -- we react to its STATUSTEXT
 * prompts rather than marching through a list of our own, so a retried or
 * reordered side still tracks correctly.
 *
 * **It starts on open.** There was a preamble stage first, and everything on
 * it belonged somewhere else: the autopilot rotation is a setting, so it is
 * on the card with the button that opens this; and what the run involves is
 * worth reading *before* deciding to start one, which is the card's note. A
 * dialog whose first screen is a paragraph and a Start button is a click
 * spent on being told what you already chose.
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
   * Which side the vehicle wants, from the vehicle's own repeated request.
   *
   * ArduPilot re-sends this every second for as long as it is waiting
   * (`send_accelcal_vehicle_position`), where the matching "Place vehicle…"
   * text is printed **once**. Following the text alone meant a wizard that
   * opened onto a calibration already in progress -- the state the vehicle is
   * left in every time one of these dialogs is closed part-way, because
   * ArduPilot has no MAVLink cancel and `start()` returns immediately while
   * one is running -- sat on "Waiting for the vehicle…" for ever.
   *
   * Only the six sides are read here. The same message carries a terminal
   * SUCCESS/FAILED, and the vehicle goes on repeating *that* long after a run
   * has finished, so a wizard that trusted it would show the last run's
   * verdict a second after starting a new one. Those come from the status
   * text, which is said once and means now.
   */
  /**
   * Show a side, from whichever source said so first.
   *
   * The side lives in a ref as well as in state because two things report it
   * -- the vehicle's repeated request and its printed line -- and they arrive
   * in either order. Reading the previous side from a ref keeps this to plain
   * state updates; setting state inside another setState's updater ran the
   * two in the wrong order and the words came out belonging to the side
   * before.
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
    // Everything before it is captured. ArduPilot walks the six in order --
    // `_step` only ever counts up -- so the side being asked for says how far
    // the run has got, which is the only thing that can fill the tiles in
    // when this dialog joins a calibration that started before it.
    setCompleted(ACCEL_POSITIONS.filter((p) => p.value < position.value).map((p) => p.id))
  }

  useEffect(() => {
    // `at` guards the rejoin: the vehicle repeats the request every second,
    // so a value from before this dialog started is the last run talking and
    // the one after it is the truth. Without that, opening onto a finished
    // run replays its last side.
    if (stage !== 'running' || !asked || asked.at < startedAt.current) return
    const position = ACCEL_POSITIONS.find((p) => p.value === asked.position)
    if (position) goTo(position, '')
    // The request is what this watches; `goTo` is recreated every render and
    // deliberately not a dependency.
  }, [stage, asked])

  // Follow the vehicle's own words too: the verdict is only ever said here,
  // and the prompt line is the firmware's phrasing of the pose.
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
        // Belt and braces with the request above: a firmware that stops
        // repeating the command, or a link that loses it, still moves the
        // wizard on -- this is the path that worked before the request was
        // read at all.
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

  // Opening the dialog is the decision; there is nothing else to ask.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void start()
    // Once, on open. `start` is recreated every render, so it is deliberately
    // not a dependency -- the ref above is what makes that safe, and it is
    // also what stops StrictMode's double mount commanding the vehicle twice.
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

  // Captured sides go green, the one being asked for goes blue. No turn
  // arrow and no bar: the accelerometer wants the vehicle held still, and
  // the vehicle decides when it has enough of each side.
  const tiles: AttitudeTile[] = ACCEL_POSITIONS.map((p) => ({
    id: FRAME[p.id],
    label: p.label,
    done: completed.includes(p.id),
    here: current?.id === p.id,
    spin: false,
    progress: null,
  }))

  const cancel = () => {
    // There is nothing to send: ArduPilot has **no MAVLink cancel** for an
    // accelerometer calibration. `AP_AccelCal::cancel()` exists and is called
    // from exactly one place -- arming the vehicle -- so a run left part-way
    // sits waiting for a side indefinitely, and the next PREFLIGHT_CALIBRATION
    // is ignored (`start()` returns early while `_started`). What makes that
    // harmless is the effect above: reopening this dialog rejoins the run
    // already in progress rather than waiting for a prompt that was printed
    // once, minutes ago.
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
          {/* The same six pictures the compass calibration uses, because they
              are the same six attitudes. A live 3D airframe turned to the
              requested side here before; it was the better picture and the
              worse screen -- two ways of drawing one idea, and it could not
              show which sides were already captured. */}
          <AttitudeTiles tiles={tiles} />

          {/* One line, and the vehicle's own words for the pose where it has
              said them -- the wizard's own sentence said the same thing in
              different words directly above it. What to press is ours,
              because the firmware still says "press any key" from a console
              it has not had in years. */}
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
