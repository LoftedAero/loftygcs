import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '../stores/connection-store'
import { useJoystickStore } from '../stores/joystick-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { DEFAULT_CONFIG, RELEASE, type JoystickConfig } from '../protocol/joystick'

// Every RC_CHANNELS_OVERRIDE the service would have put on the link, and
// every command.
const sent: number[][] = []
const commands: { command: number; params: number[] }[] = []
vi.mock('./connection', () => ({
  connectionService: {
    sendMessage: (name: string, fields: Record<string, number>) => {
      if (name !== 'RC_CHANNELS_OVERRIDE') return
      sent.push(Array.from({ length: 18 }, (_, i) => fields[`chan${i + 1}Raw`]!))
    },
    runCommand: (command: number, params: number[]) => {
      commands.push({ command, params })
      // An accepted mode change shows up in the heartbeat, as a real one does.
      if (command === 176) useVehicleStore.setState({ customMode: params[1]! })
      return Promise.resolve(0)
    },
  },
}))

const { enable, startReading, stop, stopReading } = await import('./joystick')

// With several input devices attached, reading whichever the browser listed
// first would put the sticks somewhere other than where the screen says.

const POLL_MS = 33
const SEND_MS = 50

/** A pad at rest: sticks centered, throttle (axis 1) at its low end. */
function fakePad(id: string, index: number, axes = [0, 1, 0, 0], buttons: boolean[] = []) {
  return {
    id,
    index,
    connected: true,
    axes,
    buttons: buttons.map((pressed) => ({ pressed, touched: pressed, value: pressed ? 1 : 0 })),
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

/** The desktop shell's one relevant call, recorded. */
const throttling: boolean[] = []
function inShell(on: boolean) {
  const w = window as unknown as { loftgcs?: unknown }
  if (on) w.loftgcs = { app: { setBackgroundThrottling: (a: boolean) => throttling.push(a) } }
  else delete w.loftgcs
}

function configure(patch: Partial<JoystickConfig>) {
  useJoystickStore.setState({ config: { ...DEFAULT_CONFIG, ...patch } })
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  sent.length = 0
  commands.length = 0
  throttling.length = 0
  inShell(false)
  useJoystickStore.setState({
    config: DEFAULT_CONFIG,
    devices: {},
    profiles: {},
    configFor: null,
    pads: [],
    pad: null,
    deviceId: null,
    active: false,
    message: null,
  })
  useConnectionStore.setState({ phase: 'connected' })
  useVehicleStore.setState({ sysid: 1, rcChannels: [] })
})

afterEach(() => {
  stop()
  stopReading()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  inShell(false)
})

describe('picking a device', () => {
  it('reads the only pad without asking', () => {
    attach(fakePad('Xbox Wireless Controller', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().pad?.id).toBe('Xbox Wireless Controller')
  })

  it('reads nothing while several are attached and none is chosen', () => {
    // Nothing is read rather than a guess.
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
    // The wheel now enumerates first, so every index has moved.
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
    // Must not fall back to the wheel.
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

  it('refuses without a vehicle', () => {
    attach(fakePad('Xbox Wireless Controller', 0))
    useConnectionStore.setState({ phase: 'idle' })
    expect(enable()).toMatch(/not connected/i)
    expect(sent).toHaveLength(0)
  })

  it('starts once the choice is made', () => {
    attach(fakePad('Logitech G920 Wheel', 0), fakePad('Xbox Wireless Controller', 1))
    useJoystickStore.getState().chooseDevice('Xbox Wireless Controller')
    expect(enable()).toBeNull()
    expect(useJoystickStore.getState().active).toBe(true)
  })

  it('still refuses a chosen pad whose sticks are off center', () => {
    // Choosing a device does not skip the stick check.
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0.9, 0]))
    expect(enable()).toMatch(/center the sticks/i)
  })

  it('takes control with the throttle up, as when taking over in flight', () => {
    attach(fakePad('Xbox Wireless Controller', 0, [0, 0, 0, 0]))
    expect(enable()).toBeNull()
    expect(sent[0]![2]).toBe(1500)
  })

  it('sends at once and then steadily', () => {
    attach(fakePad('Xbox Wireless Controller', 0))
    enable()
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(SEND_MS * 4)
    expect(sent).toHaveLength(5)
    // Throttle at the bottom, sticks centered, everything else untouched.
    expect(sent[0]!.slice(0, 5)).toEqual([1500, 1500, 1000, 1500, 65535])
  })

  it('starts a mapped switch where the vehicle has it, not at position one', () => {
    configure({ buttons: [{ channel: 5, button: 0, mode: 'toggle', values: [1000, 2000] }] })
    useVehicleStore.setState({ rcChannels: [1500, 1500, 1000, 1500, 1990] })
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [false]))
    enable()
    expect(sent[0]![4]).toBe(2000)
  })

  it('does not count a switch held while taking control as a press', () => {
    configure({ buttons: [{ channel: 5, button: 0, mode: 'toggle', values: [1000, 2000] }] })
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [true]))
    enable()
    vi.advanceTimersByTime(SEND_MS * 2)
    expect(sent.map((frame) => frame[4])).toEqual([1000, 1000, 1000])
  })
})

describe('handing control back', () => {
  /** Take control on a single pad and clear what was sent getting there. */
  function flying(pad = fakePad('Xbox Wireless Controller', 0)) {
    attach(pad)
    startReading()
    expect(enable()).toBeNull()
    sent.length = 0
  }

  function releases() {
    vi.advanceTimersByTime(500)
    return sent.filter((f) => f.every((v, i) => v === RELEASE[i]))
  }

  it('sends the release three times, channels 9-16 included', () => {
    flying()
    stop()
    // A release of zeros would leave 9-16 held where the gamepad left them.
    const frames = releases()
    expect(frames).toHaveLength(3)
    expect(frames[0]![8]).toBe(65534)
    expect(frames[0]![0]).toBe(0)
  })

  it('stops sending anything else once released', () => {
    flying()
    stop()
    const frames = releases()
    expect(sent).toHaveLength(frames.length)
  })

  it('releases when the chosen device disappears', () => {
    flying()
    attach() // unplugged
    vi.advanceTimersByTime(POLL_MS)
    const state = useJoystickStore.getState()
    expect(state.active).toBe(false)
    expect(state.message).toMatch(/unplugged/i)
    expect(releases()).toHaveLength(3)
  })

  it('releases when a different device takes its place', () => {
    useJoystickStore.getState().chooseDevice(null)
    flying(fakePad('Xbox Wireless Controller', 0))
    attach(fakePad('Logitech G920 Wheel', 0))
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().active).toBe(false)
  })

  it('releases when the link drops', () => {
    flying()
    useConnectionStore.setState({ phase: 'idle' })
    vi.advanceTimersByTime(SEND_MS)
    expect(useJoystickStore.getState().active).toBe(false)
    expect(useJoystickStore.getState().message).toMatch(/link/i)
  })
})

describe('out of focus', () => {
  function flying() {
    attach(fakePad('Xbox Wireless Controller', 0))
    startReading()
    expect(enable()).toBeNull()
  }

  it('keeps flying in the desktop app when the window loses focus', () => {
    inShell(true)
    flying()
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(SEND_MS)
    expect(useJoystickStore.getState().active).toBe(true)
  })

  it('turns background throttling off while flying, and back on after', () => {
    // Background throttling pauses gamepad input in a hidden window.
    inShell(true)
    flying()
    expect(throttling).toEqual([false])
    stop()
    expect(throttling).toEqual([false, true])
  })

  it('releases in a browser, which may freeze an unfocused pad', () => {
    flying()
    window.dispatchEvent(new Event('blur'))
    expect(useJoystickStore.getState().active).toBe(false)
    expect(useJoystickStore.getState().message).toMatch(/focus/i)
  })

  it('releases in either when the page is hidden', () => {
    inShell(true)
    flying()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hidden.mockRestore()
    expect(useJoystickStore.getState().active).toBe(false)
  })
})

describe('each device keeps its own mapping', () => {
  it('brings a device its own mapping when it is plugged in', () => {
    const wheel: JoystickConfig = { ...DEFAULT_CONFIG, deadzone: 0.02 }
    useJoystickStore.setState({ devices: { 'Logitech G920 Wheel': wheel } })
    attach(fakePad('Logitech G920 Wheel', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().config.deadzone).toBe(0.02)
  })

  it('does not swap the mapping under the hands while flying', () => {
    attach(fakePad('Xbox Wireless Controller', 0))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    enable()
    useJoystickStore.setState({
      devices: {
        ...useJoystickStore.getState().devices,
        'Logitech G920 Wheel': { ...DEFAULT_CONFIG, deadzone: 0.02 },
      },
    })
    // In one tick: the device changes, control is dropped, then the new
    // device's mapping applies.
    attach(fakePad('Logitech G920 Wheel', 0))
    vi.advanceTimersByTime(POLL_MS)
    expect(useJoystickStore.getState().active).toBe(false)
  })
})

describe('while mapping, before control is taken', () => {
  it('does not flip a switch with the press that taught it', () => {
    // Learn assigns the button while it is still down; the next read must not
    // count that same press.
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [true]))
    startReading()
    vi.advanceTimersByTime(POLL_MS)
    configure({ buttons: [{ channel: 5, button: 0, mode: 'toggle', values: [1000, 2000] }] })
    vi.advanceTimersByTime(POLL_MS * 2)
    expect(useJoystickStore.getState().channels[4]).toBe(1000)
  })
})

describe('flight mode buttons', () => {
  const DO_SET_MODE = 176
  const rtl: JoystickConfig = {
    ...DEFAULT_CONFIG,
    buttons: [{ channel: 5, button: 0, mode: 'mode', values: [], flightMode: 'RTL' }],
  }
  const press = (down: boolean) =>
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [down]))

  it('asks for the mode by its number on this vehicle', async () => {
    // RTL is 6 on Copter and 11 on Plane; the name is what was saved.
    for (const [vehicleType, number] of [
      [2, 6],
      [1, 11],
    ] as const) {
      commands.length = 0
      useVehicleStore.setState({ vehicleType, customMode: 0 })
      configure({ buttons: rtl.buttons })
      press(false)
      startReading()
      expect(enable()).toBeNull()
      press(true)
      await vi.advanceTimersByTimeAsync(POLL_MS)
      expect(commands).toEqual([{ command: DO_SET_MODE, params: [1, number, 0, 0, 0, 0, 0] }])
      stop()
      stopReading()
    }
  })

  it('says so when this vehicle has no mode of that name', async () => {
    useVehicleStore.setState({ vehicleType: 1 })
    configure({
      buttons: [{ channel: 5, button: 0, mode: 'mode', values: [], flightMode: 'PosHold' }],
    })
    press(false)
    startReading()
    enable()
    press(true)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(commands).toEqual([])
    expect(useJoystickStore.getState().message).toMatch(/no PosHold mode/)
  })

  it('does nothing until the gamepad has control', async () => {
    useVehicleStore.setState({ vehicleType: 2 })
    configure({ buttons: rtl.buttons })
    press(false)
    startReading()
    press(true)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(commands).toEqual([])
  })
})

describe('set buttons', () => {
  it('leave the channel alone when control is taken, then hold the one pressed', () => {
    configure({
      buttons: [
        { channel: 5, button: 0, mode: 'set', values: [1165] },
        { channel: 5, button: 1, mode: 'set', values: [1815] },
      ],
    })
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [false, false]))
    startReading()
    enable()
    expect(sent[0]![4]).toBe(65535)
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [false, true]))
    vi.advanceTimersByTime(SEND_MS)
    attach(fakePad('Xbox Wireless Controller', 0, [0, 1, 0, 0], [false, false]))
    vi.advanceTimersByTime(SEND_MS * 2)
    expect(sent.at(-1)![4]).toBe(1815)
  })
})
