import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import { useCalStore } from '../../../stores/cal-store'
import { connectionService } from '../../../services/connection'

const MAV_CMD_DO_START_MAG_CAL = 42424
const MAV_CMD_DO_ACCEPT_MAG_CAL = 42425
const MAV_CMD_DO_CANCEL_MAG_CAL = 42426

// Onboard compass calibration: the vehicle does the math and streams
// MAG_CAL_PROGRESS; the user's job is to rotate the vehicle through every
// orientation until coverage completes, then accept the offsets.
export default function CompassCalCard() {
  const magCal = useCalStore((s) => s.magCal)
  const [error, setError] = useState('')

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
        setError(`Vehicle refused to start (result ${result}). Is it armed?`)
      }
    } catch (err) {
      useCalStore.getState().magCalReset()
      setError(err instanceof Error ? err.message : 'start failed')
    }
  }

  const cancel = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_CANCEL_MAG_CAL, [0])
    } finally {
      useCalStore.getState().magCalReset()
    }
  }

  const accept = async () => {
    try {
      await connectionService.runCommand(MAV_CMD_DO_ACCEPT_MAG_CAL, [0])
      useCalStore.getState().magCalReset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'accept failed')
    }
  }

  return (
    <LaCard
      title="Compass"
      note="Rotate the vehicle slowly around every axis — the progress bar tracks sphere coverage."
    >
      {!magCal.running && !magCal.report && (
        <div className="la-row">
          <LaButton variant="secondary" onClick={() => void start()}>
            Calibrate compass
          </LaButton>
        </div>
      )}
      {magCal.running && (
        <>
          <div className="cal-progress" role="progressbar" aria-valuenow={magCal.pct}>
            <div className="cal-progress__fill" style={{ width: `${magCal.pct}%` }} />
          </div>
          <p className="app-placeholder">{magCal.pct}% — keep rotating the vehicle.</p>
          <div className="la-row">
            <LaButton variant="ghost" onClick={() => void cancel()}>
              Cancel
            </LaButton>
          </div>
        </>
      )}
      {magCal.report && (
        <>
          <LaHint error={magCal.report.calStatus !== 4}>
            {magCal.report.calStatus === 4
              ? `Calibration succeeded (fitness ${magCal.report.fitness.toFixed(1)}, lower is better).${magCal.report.autosaved ? ' Offsets saved.' : ''}`
              : `Calibration failed (status ${magCal.report.calStatus}). Move away from metal and retry.`}
          </LaHint>
          <div className="la-row">
            {magCal.report.calStatus === 4 && !magCal.report.autosaved && (
              <LaButton variant="primary" onClick={() => void accept()}>
                Accept calibration
              </LaButton>
            )}
            <LaButton variant="ghost" onClick={() => useCalStore.getState().magCalReset()}>
              Done
            </LaButton>
          </div>
        </>
      )}
      <LaHint error>{error}</LaHint>
    </LaCard>
  )
}
