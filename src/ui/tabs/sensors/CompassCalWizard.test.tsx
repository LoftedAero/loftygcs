import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import CompassCalWizard from './CompassCalWizard'
import { useCalStore } from '../../../stores/cal-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { useConnectionStore } from '../../../stores/connection-store'

// A failed calibration is the case people repeat, and the one this dialog
// could not offer: the verdict is reachable only from a vehicle that refuses
// to fit a sphere, so the buttons it shows are pinned here rather than found
// on a bench.

const DO_START = 42424
const DO_CANCEL = 42426
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246

const sent: number[] = []

vi.mock('../../../services/connection', () => ({
  connectionService: {
    runCommand: (command: number) => {
      sent.push(command)
      return Promise.resolve(0)
    },
    // `rebootAutopilot` announces the drop before it sends anything.
    expectReboot: () => {},
  },
}))

/** A run that has ended, with the status the vehicle reported for it. */
function reported(calStatus: number, autosaved = 1) {
  const cal = useCalStore.getState()
  cal.magCalStarted()
  cal.magCalProgress(0, 100, 3, [], [0, 0, 0])
  cal.magCalReport(0, { calStatus, fitness: 12.5, autosaved })
}

beforeEach(() => {
  sent.length = 0
  useCalStore.getState().magCalReset()
  useWriteFeedbackStore.getState().rebootDone()
  // Reboot now is gated on a live link, as ArduPilot gates the command
  // itself -- without this the button under test is disabled.
  useConnectionStore.setState({ phase: 'connected' })
})
afterEach(cleanup)

describe('the compass calibration dialog after a run', () => {
  it('offers another attempt without leaving, when it failed', async () => {
    reported(5)
    render(<CompassCalWizard onClose={() => {}} />)
    expect(screen.getByText(/calibration failed/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // Stopped before started: a start sent while the calibrator is still
    // sitting in FAILED races the report it is still re-sending, which would
    // re-open the verdict on top of the new run.
    await vi.waitFor(() => expect(sent).toEqual([DO_CANCEL, DO_START]))
    expect(useCalStore.getState().magCal.running).toBe(true)
  })

  it('does not offer it after a success', () => {
    reported(4)
    render(<CompassCalWizard onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByText(/succeeded/)).toBeTruthy()
  })

  it('offers the restart on the verdict that owes it, not in a second dialog', async () => {
    // The offsets are on the vehicle and the firmware is still flying the old
    // ones, which used to be said by a dialog raised as this one closed.
    reported(4)
    render(<CompassCalWizard onClose={() => {}} />)
    expect(screen.getByText(/requires reboot/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reboot now' }))
    await vi.waitFor(() => expect(sent).toEqual([DO_CANCEL, MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN]))
  })

  it('steps Later down to the card reminder rather than following the user out', () => {
    reported(4)
    render(<CompassCalWizard onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    const feedback = useWriteFeedbackStore.getState()
    expect(feedback.rebootPending).toBeTruthy()
    // Deferred, so the card shows a line and no dialog opens behind this one.
    expect(feedback.rebootDeferred).toBe(true)
  })

  it('closes by stopping the vehicle, not just the screen', () => {
    // ArduPilot re-sends MAG_CAL_REPORT while its calibrator sits in SUCCESS
    // or FAILED, so a dialog that only cleared its own copy was re-filled a
    // second later.
    reported(5)
    let closed = false
    render(<CompassCalWizard onClose={() => (closed = true)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(sent).toEqual([DO_CANCEL])
    expect(closed).toBe(true)
  })
})
