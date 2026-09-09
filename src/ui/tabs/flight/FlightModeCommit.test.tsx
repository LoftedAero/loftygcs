import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'

// Choosing a flight mode does not change it. Pressing Set does.
//
// This is a safety property before it is a consistency one: a <select>
// takes the mouse wheel, so a scroll that merely passes over the picker
// used to command a mode change on a flying aircraft -- nothing pressed,
// nothing confirmed, and no way to tell it from a deliberate one.
//
// The service is mocked rather than driven, because what is under test is
// whether a command is issued at all, and a real one would need a vehicle
// to refuse or accept it.

const sent: number[] = []
vi.mock('../../../services/flight', () => ({
  setModeConfirmed: (m: number) => {
    sent.push(m)
    return Promise.resolve(0)
  },
  arm: () => Promise.resolve(0),
  disarm: () => Promise.resolve(0),
  takeoff: () => Promise.resolve(0),
  changeSpeed: () => Promise.resolve(0),
  setGuidedAltitude: () => Promise.resolve(0),
  setCurrentMissionItem: () => Promise.resolve(0),
  preflightCalibration: () => Promise.resolve(0),
  triggerCamera: () => Promise.resolve(0),
  restartScripting: () => Promise.resolve(0),
  rebootAutopilot: () => Promise.resolve(0),
  // Not stubbed away: this decides what the Takeoff button says it will do,
  // and a stub returning a fixed answer would let the picker tests pass
  // over a button labelled wrongly.
  takeoffStyle: (vehicleType: number) => (vehicleType === 2 ? 'guided' : 'mode'),
}))

const { default: FlightControls } = await import('./FlightControls')

/** Copter: 0 Stabilize, 5 Loiter, 3 Auto, 6 RTL. */
const STABILIZE = 0
const LOITER = 5

const picker = () => screen.getByLabelText('Flight mode') as HTMLSelectElement
const setBtn = () => screen.getByTitle('Send the selected flight mode') as HTMLButtonElement

beforeEach(() => {
  sent.length = 0
  useVehicleStore.getState().reset()
  // A Copter, in Stabilize, connected.
  act(() => useVehicleStore.setState({ vehicleType: 2, customMode: STABILIZE }))
  useConnectionStore.setState({ phase: 'connected' })
})

afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle' })
})

describe('committing a flight mode', () => {
  it('sends nothing when the picker changes', () => {
    render(<FlightControls />)
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    // The whole point: a wheel over this control is not a mode change.
    expect(sent).toEqual([])
    // It does show the choice, so the pilot can see what is staged.
    expect(picker().value).toBe(String(LOITER))
  })

  it('sends it when Set is pressed', () => {
    render(<FlightControls />)
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    fireEvent.click(setBtn())
    expect(sent).toEqual([LOITER])
  })

  it('offers Set only when something is staged', () => {
    render(<FlightControls />)
    // Nothing chosen: the vehicle is already in what the picker shows.
    expect(setBtn().disabled).toBe(true)
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    expect(setBtn().disabled).toBe(false)
    // Choosing the mode it is already in is not a change either.
    fireEvent.change(picker(), { target: { value: String(STABILIZE) } })
    expect(setBtn().disabled).toBe(true)
  })

  it('follows the vehicle when the mode changes elsewhere', () => {
    render(<FlightControls />)
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    // A failsafe, or a switch on the transmitter. A choice staged before
    // that happened is not one worth still offering, so it is dropped and
    // the picker goes back to reporting what the aircraft is doing.
    act(() => useVehicleStore.setState({ customMode: 6 }))
    expect(picker().value).toBe('6')
    expect(setBtn().disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it('marks a staged mode the way a staged parameter is marked', () => {
    render(<FlightControls />)
    expect(picker().className).not.toContain('is-dirty')
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    // Orange means "this is what the button will send", everywhere else in
    // the app; the mode picker now says it the same way.
    expect(picker().className).toContain('is-dirty')
  })
})
