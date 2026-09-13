import { useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import CalAttitudes from './CalAttitudes'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
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
 * The only cal_status that means the offsets are usable.
 *
 * ArduPilot casts its own `CompassCalibrator::Status` straight into the
 * message, and that enum has outgrown MAVLink's: MAG_CAL_STATUS stops at 7
 * and the firmware also sends 8, 9 and 10. So the failures cannot be
 * enumerated from the MAVLink definition, and a build that tried would name
 * some of them and not others. They are not enumerated at all below, which
 * is also the shorter answer: the two things a person can do about any of
 * them are the same two, and a paragraph naming the arithmetic that failed
 * is a paragraph nobody acts on.
 */
const MAG_CAL_SUCCESS = 4

/**
 * Onboard compass calibration, in a dialog like the accelerometer's.
 *
 * It ran inside the Compass card until the card grew the priority table and
 * the compass settings around it. Two things were wrong with that. The
 * calibration is a *procedure with a beginning and an end* and the settings
 * beside it are not, so the two read as one list; and a card that swaps a
 * button for six attitude tiles, then for a row of progress bars, then for a
 * verdict, changes height four times in a run -- in a grid of cards, beside
 * settings somebody may be reading.
 *
 * The vehicle does the math and streams MAG_CAL_PROGRESS; the work here is
 * telling someone what to do with their hands, which is `CalAttitudes`.
 */
export default function CompassCalWizard({ onClose }: { onClose: () => void }) {
  const magCal = useCalStore((s) => s.magCal)
  const armed = useVehicleStore((s) => s.armed)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const [error, setError] = useState('')
  /** Accepted in this dialog, which `autosaved` cannot say for us. */
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
  /** New offsets are on the vehicle, and the firmware is still flying the old ones. */
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
        // No guess at the reason. ArduPilot refuses for five different
        // things and announces only three of them, so a confident "Is it
        // armed?" was wrong more often than right -- on the bench it was a
        // compass with Use off, which the card catches before the command is
        // sent.
        setError('Compass calibration failed to start.')
      }
    } catch (err) {
      useCalStore.getState().magCalReset()
      setError(err instanceof Error ? err.message : 'start failed')
    }
  }

  /**
   * End the run on the vehicle, not just on screen.
   *
   * ArduPilot re-sends MAG_CAL_REPORT for as long as its calibrator sits in
   * SUCCESS or FAILED -- `send_mag_cal_report` loops on exactly those two
   * states -- so clearing our own copy alone let the next report re-open the
   * verdict a second later. `stop()` is what ends it, and DO_CANCEL_MAG_CAL
   * is what calls `stop()`.
   */
  const stop = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_CANCEL_MAG_CAL, [0])
    } catch {
      // A vehicle that will not answer is a vehicle that is not calibrating.
    }
    useCalStore.getState().magCalReset()
  }

  /**
   * Leave.
   *
   * `remind` is Later: the need for a restart does not go away, so it steps
   * back to the line on the card rather than following the user out as a
   * second dialog. This screen used to raise that dialog on the way out and
   * it was one dialog too many -- the offer belongs on the verdict that
   * creates it, which is where the buttons are now.
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
   * Restart now, from here.
   *
   * The link drops and comes back on its own (`expectReboot` in the
   * connection service), so there is nothing for the user to do afterwards
   * and nothing this dialog needs to stay open for.
   */
  const reboot = async () => {
    await stop()
    void rebootAutopilot().catch(() => {})
    onClose()
  }

  /**
   * Run it again without leaving.
   *
   * A failed calibration is the case people repeat, usually after moving the
   * vehicle away from something or turning it more completely -- and the
   * message itself says to try again if it keeps failing. Closing the dialog
   * and finding the button again for each attempt is the wrong shape for
   * that. The old run has to be stopped and awaited first: a start sent while
   * the calibrator is still sitting in FAILED races the report it is still
   * re-sending, which would re-open the verdict on top of the new run.
   */
  const retry = async () => {
    await stop()
    await start()
  }

  const accept = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_ACCEPT_MAG_CAL, [0])
      // Not a close: accepting is what makes the restart owed, so the dialog
      // stays up to offer it.
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
          {/* The pass mark, in the row with the buttons rather than in the
              body: it is a condition of the run, not a step in it, and among
              the instructions it read as one. The report's fitness is
              `sqrtf(_fitness)` and the firmware's test is
              `_fitness > sq(_tolerance)`, so this parameter is what a run is
              judged against -- and the tolerance is read when the calibrator
              starts, so it is offered before a run and after a failed one,
              never during, where changing it would do nothing to the run in
              progress. */}
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
          {/* One primary, and which one depends on what the run left behind:
              offsets on the vehicle make the restart the next thing to do,
              offsets waiting for Accept make that it, and a failure makes it
              another attempt. Anything else that is still worth offering
              stays as a ghost beside it. */}
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
      {/* The six attitudes are on screen before the run starts as well as
          during it: they are the instruction, and reading it after the
          vehicle has begun sampling is reading it too late. */}
      <CalAttitudes magCal={magCal} />

      {/* One sentence for both stages, rather than one to read and a second
          to work from: the instruction does not change when the vehicle
          starts sampling, and two copies of it are two things to keep in
          step. */}
      {stage !== 'finished' && (
        <p className="app-placeholder">
          Hold the vehicle in each attitude and rotate it, clear of sources of magnetic noise.
        </p>
      )}

      {stage === 'running' && (
        <>
          {/* One bar per compass. They are separate calibrations from one
              command, they progress at different rates because they see
              different parts of the rotation, and a single bar was whichever
              of them reported last. */}
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
                {`Compass ${id + 1}: succeeded (fitness ${c.report.fitness.toFixed(1)}, lower is better).${c.report.autosaved ? ' Offsets saved.' : ''}`}
              </LaHint>
            )
          }
          // One sentence of what to check, one of what to change. The fitness
          // tolerance is a permanent setting on the card rather than a
          // control that appears on failure, so this names it instead of
          // growing a second control beside the message.
          return (
            <LaHint key={id} error>
              {`Compass ${id + 1}: calibration failed. Check power wiring and sources of ` +
                'interference. Consider relaxing fitness if failures persist.'}
            </LaHint>
          )
        })}

      {stage === 'finished' && saved && (
        // The whole of what the separate reboot dialog said that was worth
        // saying. Its "the vehicle reads this at startup" paragraph explained
        // a mechanism to someone who only needs to know which button to
        // press, and both buttons are right here.
        <p className="app-placeholder">{`${REBOOT_REASON}.`}</p>
      )}

      {/* ArduPilot refuses to reboot while armed, and a calibration can end
          with the motors live on a vehicle somebody armed to test something. */}
      {stage === 'finished' && saved && armed && (
        <LaHint error>Disarm the vehicle before rebooting.</LaHint>
      )}

      <LaHint error>{error}</LaHint>
      <WriteFeedback />
    </LaModal>
  )
}
