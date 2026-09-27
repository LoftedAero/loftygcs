import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import JoystickPanel from './JoystickPanel'
import { useJoystickStore } from '../../../stores/joystick-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { DEFAULT_CONFIG } from '../../../protocol/joystick'

const PAD = { index: 0, id: 'Xbox Wireless Controller' }

beforeEach(() => {
  localStorage.clear()
  useConnectionStore.setState({ phase: 'connected' } as never)
  useJoystickStore.setState({
    config: DEFAULT_CONFIG,
    devices: {},
    profiles: {},
    configFor: null,
    pads: [],
    pad: null,
    axes: [],
    buttons: [],
    channels: [],
    active: false,
    message: null,
    deviceId: null,
  })
})

afterEach(() => cleanup())

/** The two knobs' offsets from center, left stick then right, in the drawing's units. */
const knobs = () =>
  [...document.querySelectorAll<SVGGElement>('.joystick-panel .stick-diagram__knob')].map((k) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(k.style.transform)!
    return [Number(m[1]), Number(m[2])]
  })

const sending = (channels: number[]) =>
  act(() => useJoystickStore.getState().setLive([0, 1, 0, 0], [], channels))

describe('the joystick pane', () => {
  it('draws the sticks where the channels put them', () => {
    useJoystickStore.getState().setPads([PAD], PAD)
    render(<JoystickPanel />)
    // Roll full right, pitch centered, throttle at the bottom, yaw full left.
    sending([2000, 1500, 1000, 1000])
    const [left, right] = knobs()
    expect(right![0]).toBeGreaterThan(0)
    expect(right![1]).toBe(0)
    // Throttle down is the bottom of the gate: screen y grows downward.
    expect(left![1]).toBeGreaterThan(0)
    expect(left![0]).toBeLessThan(0)
  })

  it('leaves the sticks centered with no gamepad, rather than drawing a guess', () => {
    render(<JoystickPanel />)
    sending([2000, 1500, 1000, 1000])
    expect(knobs()).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  it('edits nothing itself: the mapping is changed in Configure only', () => {
    useJoystickStore.getState().setPads([PAD], PAD)
    render(<JoystickPanel />)
    const pane = document.querySelector('.joystick-panel__body')!
    expect(pane.querySelectorAll('select, input')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    const dialog = screen.getByText('Gamepad settings').closest('.la-modal')!
    expect(dialog.classList.contains('hidden')).toBe(false)
  })

  it('cannot be configured while the gamepad has control', () => {
    useJoystickStore.getState().setPads([PAD], PAD)
    useJoystickStore.setState({ active: true })
    render(<JoystickPanel />)
    expect((screen.getByRole('button', { name: 'Configure' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('the device list', () => {
  const list = () => screen.getByLabelText('Which device to fly with') as HTMLSelectElement
  const shown = () => list().selectedOptions[0]!.textContent
  const WHEEL = { index: 1, id: 'Logitech G920 Wheel' }

  it('is drawn with nothing in it, saying what to do', () => {
    // Chromium hides every gamepad until a button is pressed on one.
    render(<JoystickPanel />)
    expect(list().disabled).toBe(true)
    expect(shown()).toBe('Press a button on a controller')
  })

  it('shows the only device as the one in use', () => {
    useJoystickStore.getState().setPads([PAD], PAD)
    render(<JoystickPanel />)
    expect(list().disabled).toBe(false)
    expect(shown()).toBe('Xbox Wireless Controller')
  })

  it('asks which, with several and none chosen', () => {
    useJoystickStore.getState().setPads([PAD, WHEEL], null)
    render(<JoystickPanel />)
    expect(shown()).toBe('Choose a device')
    expect([...list().options].map((o) => o.textContent)).toEqual([
      'Choose a device',
      'Xbox Wireless Controller',
      'Logitech G920 Wheel',
    ])
  })

  it('keeps naming a remembered device that is not attached, rather than another', () => {
    useJoystickStore.setState({ deviceId: 'Thrustmaster T.16000M' })
    useJoystickStore.getState().setPads([WHEEL], null)
    render(<JoystickPanel />)
    expect(shown()).toBe('Thrustmaster T.16000M')
    expect(screen.getByText('That device is no longer attached.')).toBeTruthy()
  })
})
