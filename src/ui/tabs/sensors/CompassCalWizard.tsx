import { useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import CalAttitudes from './CalAttitudes'
import ParamField from '../../components/ParamField'
import { magCalFinished, magCalList, useCalStore } from '../../../stores/cal-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { rebootAutopilot } from '../../../services/flight'

const MAV_CMD_DO_START_MAG_CAL = 42424
const MAV_CMD_DO_ACCEPT_MAG_CAL = 42425
const MAV_CMD_DO_CANCEL_MAG_CAL = 42426

const REBOOT_REASON = 'Compass calibration requires reboot'

/**
 * The only cal_status that means the offsets are usable. ArduPilot sends its
 * own `CompassCalibrator::Status`, which goes past MAVLink's MAG_CAL_STATUS
 * (up to 10 versus 7), so failure codes are not enumerated here.
 */
const MAG_CAL_SUCCESS = 4

/**
 * Onboard compass calibration, in a dialog like the accelerometer's, since it
 * is a procedure with a start and an end rather than a setting.
 *
 * The vehicle does the math and streams MAG_CAL_PROGRESS; `CalAttitudes`
 * guides the user through the rotations.
 */
export default function CompassCalWizard({ onClose }: { onClose: () => void }) {
  const magCal = useCalStore((s) => s.magCal)
  const armed = useVehicleStore((s) => s.armed)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const [error, setError] = useState('')
  /** Accepted in this dialog (not reflected in `autosaved`). */
  const [accepted, setAccepted] = useState(false)

  const progress = magCalList(magCal)
  const finished = magCalFinished(magCal)
  const stage = finished ? 'finished' : magCal.running ? 'running' : 'confirm'
  const anySucceeded = progress.some(([, c]) => c.report?.calStatus === MAG_CAL_SUCCESS)
  const anyFailed = progress.some(
    ([, c]) => c.report !== null && c.report.calStatus !== MAG_CAL_SUCCESS,
  )
  const everySaved = progress.every(
    ([, c]) => c.report?.calStatus !== MAG_CAL_SUCCESS || c.report.autosaved,
  )
  /** New offsets are saved, but the running firmware still uses the old ones. */
  const saved = anySucceeded && (everySaved || accepted)

  const start = async () => {
    setError('')
    useCalStore.getState().magCalStarted()
    try {
      // param1=0: all compasses; param3=1: autosave on success.
      const result = await connectionService.runCommand(
        MAV_CMD_DO_START_MAG_CAL,
        [0, 0, 1, 0, 0, 0, 0],
        5000,
      )
      if (result !== 0) {
        useCalStore.getState().magCalReset()
        // No guess at the reason: ArduPilot refuses for several reasons and
        // announces only some of them.
        setError('Compass calibration failed to start.')
      }
    } catch (err) {
      useCalStore.getState().magCalReset()
      setError(err instanceof Error ? err.message : 'start failed')
    }
  }

  /**
   * Ends the run on the vehicle, not just on screen. ArduPilot re-sends
   * MAG_CAL_REPORT while its calibrator is in SUCCESS or FAILED, which would
   * reopen the verdict; DO_CANCEL_MAG_CAL calls the calibrator's `stop()`.
   */
  const stop = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_CANCEL_MAG_CAL, [0])
    } catch {
      // A vehicle that does not answer is not calibrating.
    }
    useCalStore.getState().magCalReset()
  }

  /**
   * Closes the dialog. `remind` (Later) leaves the pending reboot as the
   * card's inline reminder rather than a second dialog.
   */
  const close = (remind: boolean) => {
    void stop()
    if (remind) {
      const feedback = useWriteFeedbackStore.getState()
      feedback.needReboot(REBOOT_REASON)
      feedback.deferReboot()
    }
    onClose()
  }

  /**
   * Reboots now and closes. The link reconnects on its own (`expectReboot`
   * in the connection service).
   */
  const reboot = async () => {
    await stop()
    void rebootAutopilot().catch(() => {})
    onClose()
  }

  /**
   * Runs again without closing. The old run is stopped and awaited first: a
   * start sent while the calibrator is still in FAILED races the report it
   * keeps re-sending, which would reopen the verdict over the new run.
   */
  const retry = async () => {
    await stop()
    await start()
  }

  const accept = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_ACCEPT_MAG_CAL, [0])
      // Stays open: accepting makes a reboot necessary, which it then offers.
      setAccepted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'accept failed')
    }
  }

  return (
    <LaModal
      open
      title="Compass calibration"
      actions={
        <>
          {/* The pass threshold: the firmware fails a run when
              `_fitness > sq(_tolerance)`. It is read when the calibrator
              starts, so it is offered only before a run and after a failure. */}
          {(stage === 'confirm' || anyFailed) && (
            <ParamField param="COMPASS_CAL_FIT" label="Calibration fitness" writeNow />
          )}
          {stage === 'confirm' && (
            <>
              <LaButton variant="ghost" onClick={() => close(false)}>
                Cancel
              </LaButton>
              <LaButton variant="primary" onClick={() => void start()}>
                Start
              </LaButton>
            </>
          )}
          {stage === 'running' && (
            <LaButton variant="ghost" onClick={() => close(false)}>
              Cancel
            </LaButton>
          )}
          {/* One primary action, depending on the outcome: reboot if the
              offsets were saved, accept if they await acceptance, otherwise
              try again. */}
          {stage === 'finished' && saved && (
            <>
              <LaButton
                variant="primary"
                disabled={!connected || armed}
                onClick={() => void reboot()}
              >
                Reboot now
              </LaButton>
              {anyFailed && (
                <LaButton variant="ghost" onClick={() => void retry()}>
                  Try again
                </LaButton>
              )}
              <LaButton variant="ghost" onClick={() => close(true)}>
                Later
              </LaButton>
            </>
          )}
          {stage === 'finished' && !saved && anySucceeded && (
            <>
              <LaButton variant="primary" onClick={() => void accept()}>
                Accept calibration
              </LaButton>
              <LaButton variant="ghost" onClick={() => close(false)}>
                Done
              </LaButton>
            </>
          )}
          {stage === 'finished' && !saved && !anySucceeded && (
            <>
              <LaButton variant="primary" onClick={() => void retry()}>
                Try again
              </LaButton>
              <LaButton variant="ghost" onClick={() => close(false)}>
                Done
              </LaButton>
            </>
          )}
        </>
      }
    >
      {/* Shown before the run too, since they are the instructions. */}
      <CalAttitudes magCal={magCal} />

      {stage !== 'finished' && (
        <p className="app-placeholder">
          Hold the vehicle in each attitude and rotate it, clear of sources of magnetic noise.
        </p>
      )}

      {stage === 'running' && (
        <>
          {/* One bar per compass: each is a separate calibration progressing
              at its own rate. */}
          {progress.map(([id, c]) => (
            <div className="cal-compass" key={id}>
              <span className="cal-compass__name">Compass {id + 1}</span>
              <div className="cal-progress" role="progressbar" aria-valuenow={c.pct}>
                <div className="cal-progress__fill" style={{ width: `${c.pct}%` }} />
              </div>
              <span className="cal-compass__pct">{c.report ? 'done' : `${c.pct}%`}</span>
            </div>
          ))}
        </>
      )}

      {stage === 'finished' &&
        progress.map(([id, c]) => {
          if (c.report?.calStatus === MAG_CAL_SUCCESS) {
            return (
              <LaHint key={id}>
                {`Compass ${id + 1}: succeeded (fitness ${c.report.fitness.toFixed(1)}).${c.report.autosaved ? ' Offsets saved.' : ''}`}
              </LaHint>
            )
          }
          // What to check, then what to change; the fitness field is in the
          // action row.
          return (
            <LaHint key={id} error>
              {`Compass ${id + 1}: calibration failed. Check power wiring and sources of ` +
                'interference. Consider relaxing fitness if failures persist.'}
            </LaHint>
          )
        })}

      {stage === 'finished' && saved && (
        // The reboot and Later buttons are in the action row.
        <p className="app-placeholder">{`${REBOOT_REASON}.`}</p>
      )}

      {/* ArduPilot refuses to reboot while armed. */}
      {stage === 'finished' && saved && armed && (
        <LaHint error>Disarm the vehicle before rebooting.</LaHint>
      )}

      <LaHint error>{error}</LaHint>
    </LaModal>
  )
}
