import { describe, expect, it } from 'vitest'
import {
  barFirmware,
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
    // No placeholder when disconnected; QGroundControl and Betaflight do
    // the same.
    expect(at({ phase: 'idle' })).toBeNull()
  })

  it('does not paint a reboot we asked for as a fault', () => {
    // The link is down because we asked and is coming back, so it gets the
    // same tone as "Opening link".
    expect(at({ phase: 'rebooting' })).toEqual({ text: 'Rebooting', tone: 'idle' })
  })

  it('keeps a failed connection on screen', () => {
    // "Nothing is listening" separates a simulator that is not running from
    // a mistyped port, so the sentence is kept behind the short word.
    expect(at({ phase: 'error', error: 'Nothing is listening at 127.0.0.1:5760.' })).toEqual({
      text: 'Connection failed',
      tone: 'bad',
      detail: 'Nothing is listening at 127.0.0.1:5760.',
    })
    expect(at({ phase: 'error', error: 'No heartbeat received. Check the settings.' })).toEqual({
      text: 'No heartbeat',
      tone: 'bad',
      detail: 'No heartbeat received. Check the settings.',
    })
    expect(at({ phase: 'error', error: null })).toEqual({
      text: 'Connection failed',
      tone: 'bad',
    })
  })

  it('reports the link before anything about the vehicle', () => {
    expect(at({ phase: 'opening' })).toEqual({ text: 'Opening link', tone: 'idle' })
    expect(at({ phase: 'handshaking' })).toEqual({ text: 'Waiting for heartbeat', tone: 'idle' })
    // Armed and in a failsafe, but with the link gone those are stale.
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
    // No prearm bit in the present mask, so neither Ready nor Not ready.
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
    // MAVLink's -1 means unknown, which is not the same as empty.
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
    // Any signal lights one bar, so a weak link differs from none.
    expect(signalBars(1)).toBe(1)
  })
})

describe('coloring the battery by the vehicle own thresholds', () => {
  it('says nothing when the aircraft has not configured one', () => {
    // A reading is only low against a threshold, and the app does not
    // invent one.
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

describe('the firmware readout', () => {
  it('names the vehicle type and version', () => {
    expect(barFirmware('Copter', { major: 4, minor: 7, patch: 1, type: 255 })).toBe('Copter 4.7.1')
  })

  it('says so when the build is not a release, and stays quiet when it is', () => {
    // Only a non-release build is worth flagging on the bar.
    expect(barFirmware('Plane', { major: 4, minor: 8, patch: 0, type: 128 })).toBe(
      'Plane 4.8.0-beta',
    )
    expect(barFirmware('Plane', { major: 4, minor: 8, patch: 0, type: 0 })).toBe('Plane 4.8.0-dev')
    expect(barFirmware('Plane', { major: 4, minor: 8, patch: 0, type: 255 })).toBe('Plane 4.8.0')
  })

  it('is a dash until the vehicle has said, never a zero version', () => {
    expect(barFirmware('Copter', null)).toBe('—')
  })
})
