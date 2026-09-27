import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVehicleStore } from '../stores/vehicle-store'
import { useParamStore } from '../stores/param-store'

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
/** ArduPlane's Takeoff mode, and its Guided. */
const PLANE_TAKEOFF = 13
const PLANE_GUIDED = 15

/** A parameter entry, for the one value that separates the two planes. */
const qParam = (value: number) => ({ name: 'Q_ENABLE', value, mavType: 2, dirty: false }) as never
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
    // ArduPilot can ack DO_SET_MODE as ACCEPTED and then decline the change
    // ("requires position").
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
    // NAV_TAKEOFF from Stabilize is refused, and the aircraft then disarms
    // itself on the ground.
    setTimeout(() => useVehicleStore.setState({ customMode: GUIDED }), 50)
    await expect(takeoff(20)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE, NAV_TAKEOFF])
    expect(sent[0]?.params[1]).toBe(GUIDED)
    expect(sent[1]?.params[6]).toBe(20)
  })

  it('does not command a climb it could not get into Guided for', async () => {
    // The heartbeat never reaches Guided, so takeoff is not sent; the error
    // should name the mode, not the refused takeoff.
    const result = await takeoff(20, 300)
    expect(result).toBe(4)
    expect(sent.some((s) => s.command === NAV_TAKEOFF)).toBe(false)
  })

  it('re-arms if the mode switch outlasted the ground disarm timer', async () => {
    // Copter disarms itself after about ten seconds armed on the ground,
    // which can happen during the switch to Guided, so re-arm.
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

  it('takes a quadplane off the copter way, which is the vertical one', async () => {
    // On SITL, Guided + NAV_TAKEOFF climbs vertically, while mode TAKEOFF
    // makes a runway takeoff run. Both are ACCEPTED, so the ack cannot tell
    // them apart.
    useParamStore.setState({ entries: new Map([['Q_ENABLE', qParam(1)]]) })
    useVehicleStore.setState({ vehicleType: 1, customMode: 5, armed: true })
    setTimeout(() => useVehicleStore.setState({ customMode: PLANE_GUIDED }), 30)
    await expect(takeoff(20)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE, NAV_TAKEOFF])
    expect(sent[0]?.params[1]).toBe(PLANE_GUIDED)
    // And it climbs to the altitude asked for, not to TKOFF_ALT.
    expect(sent[1]?.params[6]).toBe(20)
  })

  it('falls to the harmless route when Q_ENABLE has not arrived', async () => {
    // Before parameters download the airframe is unknown. Guessing quadplane
    // on a fixed wing just gets FAILED back; the opposite guess starts a
    // runway run in a VTOL aircraft.
    useParamStore.setState({ entries: new Map() })
    useVehicleStore.setState({ vehicleType: 1, customMode: 5, armed: true })
    setTimeout(() => useVehicleStore.setState({ customMode: PLANE_GUIDED }), 30)
    await takeoff(20)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE, NAV_TAKEOFF])
  })

  it('takes a plane off by mode, because the command does not work there', async () => {
    // A fixed wing answers NAV_TAKEOFF with FAILED, and NAV_VTOL_TAKEOFF is
    // UNSUPPORTED on both plane types (a mission item with no runtime
    // handler). Mode TAKEOFF works, so only a mode change is sent.
    useParamStore.setState({ entries: new Map([['Q_ENABLE', qParam(0)]]) })
    useVehicleStore.setState({ vehicleType: 1, customMode: 0 })
    setTimeout(() => useVehicleStore.setState({ customMode: PLANE_TAKEOFF }), 30)
    await expect(takeoff(30)).resolves.toBe(0)
    expect(sent.map((s) => s.command)).toEqual([DO_SET_MODE])
    expect(sent[0]?.params[1]).toBe(PLANE_TAKEOFF)
    expect(sent.some((s) => s.command === NAV_TAKEOFF)).toBe(false)
  })

  it('refuses on a vehicle with no takeoff at all', async () => {
    // A rover: unsupported.
    useVehicleStore.setState({ vehicleType: 10, customMode: 0 })
    await expect(takeoff(30)).resolves.toBe(3)
    expect(sent).toEqual([])
  })
})
