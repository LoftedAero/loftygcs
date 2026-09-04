import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVehicleStore } from '../stores/vehicle-store'

// The commands the connection would have sent, and the answers it gives back.
const sent: { command: number; params: number[] }[] = []
let ackFor: (command: number) => number = () => 0

vi.mock('./connection', () => ({
  connectionService: {
    runCommand: (command: number, params: number[]) => {
      sent.push({ command, params })
      const result = ackFor(command)
      // An accepted arm shows up in the heartbeat, the way a real one does.
      if (command === 400 && result === 0) {
        useVehicleStore.setState({ armed: params[0] === 1 })
      }
      return Promise.resolve(result)
    },
    sendMessage: () => {},
  },
}))

const { setModeConfirmed, takeoff } = await import('./flight')

const DO_SET_MODE = 176
const NAV_TAKEOFF = 22
const ARM = 400
const COPTER = 2
const GUIDED = 4
const STABILIZE = 0

beforeEach(() => {
  sent.length = 0
  ackFor = () => 0
  // Armed, because the Takeoff button is only enabled on an armed vehicle.
  useVehicleStore.setState({ vehicleType: COPTER, customMode: STABILIZE, armed: true })
})

describe('setModeConfirmed', () => {
  it('believes the heartbeat, not the ack', async () => {
    // ArduPilot acknowledges DO_SET_MODE and then declines the change --
    // "requires position" -- leaving the ack saying ACCEPTED forever.
    const result = await setModeConfirmed(GUIDED, 200)
    expect(sent[0]?.command).toBe(DO_SET_MODE)
    expect(result).toBe(4) // MAV_RESULT_FAILED
  })

  it('accepts once the heartbeat reports the mode', async () => {
    setTimeout(() => useVehicleStore.setState({ customMode: GUIDED }), 50)
    await expect(setModeConfirmed(GUIDED)).resolves.toBe(0)
  })

  it('passes a refused ack straight back', async () => {
    ackFor = () => 3 // MAV_RESULT_DENIED
    await expect(setModeConfirmed(GUIDED)).resolves.toBe(3)
  })
})

describe('takeoff', () => {
  it('switches a Copter to Guided before commanding the climb', async () => {
    // The bug this exists for: NAV_TAKEOFF from Stabilize is refused, and
    // the aircraft then auto-disarms on the ground having done nothing.
    setTimeout(() => useVehicleStore.setState({ customMode: GUIDED }), 50)
    await expect(takeoff(20)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE, NAV_TAKEOFF])
    expect(sent[0]?.params[1]).toBe(GUIDED)
    expect(sent[1]?.params[6]).toBe(20)
  })

  it('does not command a climb it could not get into Guided for', async () => {
    // The heartbeat never reaches Guided, so takeoff must not be sent: a
    // NAV_TAKEOFF in Stabilize is refused, and reporting that refusal would
    // hide the real reason, which is the mode.
    const result = await takeoff(20, 300)
    expect(result).toBe(4)
    expect(sent.some((s) => s.command === NAV_TAKEOFF)).toBe(false)
  })

  it('re-arms if the mode switch outlasted the ground disarm timer', async () => {
    // Copter disarms itself after about ten seconds sitting armed on the
    // ground, which the switch into Guided is quite capable of outlasting --
    // so the arm the button insisted on can be gone by the time we get
    // there. Putting it back beats refusing a takeoff that was asked for.
    useVehicleStore.setState({ armed: false })
    setTimeout(() => useVehicleStore.setState({ customMode: GUIDED }), 30)
    await expect(takeoff(20)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE, ARM, NAV_TAKEOFF])
    expect(sent[1]?.params[0]).toBe(1) // arm, not disarm
  })

  it('reports a refused re-arm instead of commanding a climb', async () => {
    useVehicleStore.setState({ armed: false })
    setTimeout(() => useVehicleStore.setState({ customMode: GUIDED }), 30)
    ackFor = (c) => (c === ARM ? 4 : 0)
    await expect(takeoff(20)).resolves.toBe(4)
    expect(sent.some((s) => s.command === NAV_TAKEOFF)).toBe(false)
  })

  it('skips the mode change when already in Guided', async () => {
    useVehicleStore.setState({ customMode: GUIDED })
    await expect(takeoff(15)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([NAV_TAKEOFF])
  })

  it('leaves a Plane alone -- its takeoff is a mission item', async () => {
    useVehicleStore.setState({ vehicleType: 1, customMode: 0 })
    await takeoff(30)
    expect(sent.map((s) => s.command)).toEqual([NAV_TAKEOFF])
  })
})
