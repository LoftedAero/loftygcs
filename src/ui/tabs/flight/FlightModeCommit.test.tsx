import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'

// Choosing a flight mode does not change it. Pressing Set does.
//
// A <select> takes the mouse wheel, so without this a scroll passing over
// the picker would command a mode change on a flying aircraft.
//
// The service is mocked because what is under test is whether a command is
// issued at all.

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
  // A working stand-in, since this decides the Takeoff button's label.
  takeoffStyle: (vehicleType: number) => (vehicleType === 2 ? 'guided' : 'mode'),
}))

const { default: FlightControls } = await import('./FlightControls')

/** Copter: 0 Stabilize, 5 Loiter, 3 Auto, 6 RTL. */
const STABILIZE = 0
const LOITER = 5

const picker = () => screen.getByLabelText('Flight mode') as HTMLSelectElement
// The Set beside the mode picker; the action row has a Set of its own.
const setBtn = () =>
  within(picker().closest('.flight-controls__group') as HTMLElement).getByRole('button', {
    name: 'Set',
  }) as HTMLButtonElement

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
    // A wheel over this control is not a mode change.
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
    // A failsafe or a transmitter switch changes the mode: the staged choice
    // is dropped and the picker shows the aircraft's mode again.
    act(() => useVehicleStore.setState({ customMode: 6 }))
    expect(picker().value).toBe('6')
    expect(setBtn().disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it('marks a staged mode the way a staged parameter is marked', () => {
    render(<FlightControls />)
    expect(picker().className).not.toContain('is-dirty')
    fireEvent.change(picker(), { target: { value: String(LOITER) } })
    // Orange marks what the button will send, as elsewhere in the app.
    expect(picker().className).toContain('is-dirty')
  })
})
