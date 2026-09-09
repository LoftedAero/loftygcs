import { describe, expect, it } from 'vitest'
import {
  barStatus,
  batteryFill,
  batteryTone,
  reports,
  signalBars,
  type VehicleStatusInput,
} from './app-status'
import { SENSOR_BITS } from '../../protocol/sensors'

const MAV_STATE_ACTIVE = 4
const MAV_STATE_CRITICAL = 5

const base: VehicleStatusInput = {
  phase: 'connected',
  error: null,
  present: true,
  armed: false,
  systemStatus: MAV_STATE_ACTIVE,
  sensorsPresent: SENSOR_BITS.prearm,
  sensorsHealth: SENSOR_BITS.prearm,
}
const at = (p: Partial<VehicleStatusInput>) => barStatus({ ...base, ...p })

describe('the app bar status word', () => {
  it('says nothing at all when there is nothing to say', () => {
    // The state where the Connect button is the whole story. Both
    // references remove their status rather than render a placeholder,
    // which is the behavior this null drives.
    expect(at({ phase: 'idle' })).toBeNull()
  })

  it('keeps a failed connection on screen', () => {
    // The one thing the readout this replaced was genuinely good for:
    // "connection refused" separates a simulator that is not running from a
    // port typed wrong, and nothing else in the window would say it.
    expect(at({ phase: 'error', error: 'connect ECONNREFUSED 127.0.0.1:5760' })).toEqual({
      text: 'connect ECONNREFUSED 127.0.0.1:5760',
      tone: 'bad',
    })
    expect(at({ phase: 'error', error: null })).toEqual({
      text: 'Connection failed',
      tone: 'bad',
    })
  })

  it('reports the link before anything about the vehicle', () => {
    expect(at({ phase: 'opening' })).toEqual({ text: 'Opening link', tone: 'idle' })
    expect(at({ phase: 'handshaking' })).toEqual({ text: 'Waiting for heartbeat', tone: 'idle' })
    // Armed and in a failsafe, but the link is gone -- so the link is what
    // it says. Anything else would be reporting a stale reading as live.
    expect(at({ phase: 'linkLost', armed: true, systemStatus: MAV_STATE_CRITICAL })).toEqual({
      text: 'Link lost',
      tone: 'bad',
    })
  })

  it('puts a failsafe above the arm state', () => {
    expect(at({ armed: true, systemStatus: MAV_STATE_CRITICAL })).toEqual({
      text: 'Failsafe',
      tone: 'bad',
    })
  })

  it('reads arming the way the Preflight pane reads it', () => {
    expect(at({ armed: true })).toEqual({ text: 'Armed', tone: 'ok' })
    expect(at({})).toEqual({ text: 'Ready', tone: 'ok' })
    expect(at({ sensorsHealth: 0 })).toEqual({ text: 'Not ready', tone: 'warn' })
  })

  it('will not claim readiness a vehicle never reported', () => {
    // No prearm bit in the present mask. Saying "Ready" here would be this
    // app's opinion rather than the vehicle's, and saying "Not ready" would
    // train the pilot to ignore the line that matters.
    expect(at({ sensorsPresent: 0, sensorsHealth: 0 })).toEqual({
      text: 'Connected',
      tone: 'idle',
    })
  })

  it('waits for the vehicle to identify itself', () => {
    expect(at({ present: false })).toEqual({ text: 'Connected', tone: 'idle' })
  })
})

describe('gating an indicator on what the vehicle found', () => {
  it('separates a missing sensor from one reading zero', () => {
    expect(reports(SENSOR_BITS.battery, SENSOR_BITS.battery)).toBe(true)
    expect(reports(SENSOR_BITS.gps, SENSOR_BITS.battery)).toBe(false)
    expect(reports(0, SENSOR_BITS.battery)).toBe(false)
  })
})

describe('drawing a reading as a picture of itself', () => {
  it('leaves the battery empty when the vehicle has no estimate', () => {
    // MAVLink's -1. An empty cell and a flat one look alike and are not, so
    // null is carried through rather than collapsed to zero.
    expect(batteryFill(-1)).toBeNull()
    expect(batteryFill(0)).toBe(0)
    expect(batteryFill(78)).toBeCloseTo(0.78)
    expect(batteryFill(100)).toBe(1)
    // A vehicle reporting past the ends still draws a valid cell.
    expect(batteryFill(140)).toBe(1)
  })

  it('lights bars in quarters of the reported RSSI', () => {
    expect(signalBars(-1)).toBeNull() // the link does not report it
    expect(signalBars(0)).toBe(0)
    expect(signalBars(254)).toBe(4)
    expect(signalBars(127)).toBe(2)
    // Anything at all lights one bar: a weak link and no link are different
    // things and must not draw the same.
    expect(signalBars(1)).toBe(1)
  })
})

describe('coloring the battery by the vehicle own thresholds', () => {
  it('says nothing when the aircraft has not configured one', () => {
    // The reason the battery carried no color at all before these were
    // wired in: a percentage is only low against a threshold, and inventing
    // one puts this app opinion on the bar in the vehicle voice.
    expect(batteryTone(10.2, undefined, undefined)).toBeUndefined()
    expect(batteryTone(10.2, 0, 0)).toBeUndefined()
  })

  it('uses BATT_LOW_VOLT and BATT_CRT_VOLT', () => {
    expect(batteryTone(12.4, 10.5, 10.0)).toBeUndefined()
    expect(batteryTone(10.5, 10.5, 10.0)).toBe('warn')
    expect(batteryTone(10.0, 10.5, 10.0)).toBe('bad')
    expect(batteryTone(9.1, 10.5, 10.0)).toBe('bad')
  })

  it('has no opinion about a pack it cannot see', () => {
    expect(batteryTone(0, 10.5, 10.0)).toBeUndefined()
  })
})
