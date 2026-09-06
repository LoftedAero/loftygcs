import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '../stores/connection-store'
import { useJoystickStore } from '../stores/joystick-store'
import { enable, startReading, stop, stopReading } from './joystick'

// Choosing which device to read is a safety question, not a convenience
// one: with a wheel, a HOTAS and a gamepad on the same desk, reading
// "whichever the browser listed first" means the sticks are somewhere
// other than where the screen says they are.

const POLL_MS = 33

/** A pad at rest: sticks centered, throttle (axis 1) at its low end. */
function fakePad(id: string, index: number, axes = [0, 1, 0, 0]): Gamepad {
  return {
    id,
    index,
    connected: true,
    axes,
    buttons: [],
    mapping: 'standard',
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad
}

function attach(...pads: Gamepad[]) {
  vi.stubGlobal('navigator', {
    ...navigator,
    getGamepads: () => pads,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  useJoystickStore.setState({ pads: [], pad: null, deviceId: null, active: false, message: null })
  useConnectionStore.setState({ phase: 'connected' })
})

afterEach(() => {
  stop()
  stopReading()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('picking a device', () => {
  it('reads the only pad without asking', () => {
    attach(fakePad('Xbox Wireless Controller', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().pad?.id).toBe('Xbox Wireless Controller')
  })

  it('reads nothing while several are attached and none is chosen', () => {
    // The heart of it: silence rather than a guess.
    attach(fakePad('Logitech G920 Wheel', 0), fakePad('Xbox Wireless Controller', 1))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    const state = useJoystickStore.getState()
    expect(state.pads).toHaveLength(2)
    expect(state.pad).toBeNull()
  })

  it('reads the chosen one, whatever order the browser lists them in', () => {
    attach(fakePad('Logitech G920 Wheel', 0), fakePad('Xbox Wireless Controller', 1))
    useJoystickStore.getState().chooseDevice('Xbox Wireless Controller')
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().pad?.id).toBe('Xbox Wireless Controller')
  })

  it('remembers the device by id, not by index', () => {
    // The wheel is plugged in first today, so every index has moved. A
    // remembered index would silently be a different device.
    useJoystickStore.getState().chooseDevice('Xbox Wireless Controller')
    attach(fakePad('Xbox Wireless Controller', 1), fakePad('Logitech G920 Wheel', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().pad?.id).toBe('Xbox Wireless Controller')
    expect(localStorage.getItem('loftgcs.joystick.device')).toBe('Xbox Wireless Controller')
  })

  it('reads nothing when the chosen device is gone but others remain', () => {
    useJoystickStore.getState().chooseDevice('Xbox Wireless Controller')
    attach(fakePad('Logitech G920 Wheel', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    // Falling back to the wheel here would be the exact substitution this
    // whole mechanism exists to prevent.
    expect(useJoystickStore.getState().pad).toBeNull()
  })
})

describe('taking control', () => {
  it('refuses, and says why, while the choice is open', () => {
    attach(fakePad('Logitech G920 Wheel', 0), fakePad('Xbox Wireless Controller', 1))
    expect(enable()).toMatch(/choose which one/i)
    expect(useJoystickStore.getState().active).toBe(false)
  })

  it('says something different when there is simply nothing attached', () => {
    attach()
    expect(enable()).toMatch(/no gamepad/i)
  })

  it('starts once the choice is made', () => {
    attach(fakePad('Logitech G920 Wheel', 0), fakePad('Xbox Wireless Controller', 1))
    useJoystickStore.getState().chooseDevice('Xbox Wireless Controller')
    expect(enable()).toBeNull()
    expect(useJoystickStore.getState().active).toBe(true)
  })

  it('still refuses a chosen pad whose throttle is up', () => {
    // Choosing a device does not skip the stick check.
    attach(fakePad('Xbox Wireless Controller', 0, [0, -1, 0, 0]))
    expect(enable()).toMatch(/throttle down/i)
  })

  it('drops control when the chosen device disappears', () => {
    const pad = fakePad('Xbox Wireless Controller', 0)
    attach(pad)
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(enable()).toBeNull()

    attach() // unplugged
    vi.advanceTimersByTime(POLL_MS)
    const state = useJoystickStore.getState()
    expect(state.active).toBe(false)
    expect(state.message).toMatch(/unplugged/i)
  })
})
