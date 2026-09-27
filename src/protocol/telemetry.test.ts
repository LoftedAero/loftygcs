import { describe, expect, it } from 'vitest'
import { mergeServoOutputs, messageToDeltas, packVoltage } from './telemetry'
import type { DecodedMessage } from './types'

function servoRaw(port: number, values: number[]): DecodedMessage {
  const fields: Record<string, number> = { timeUsec: 0, port }
  values.forEach((v, i) => {
    fields[`servo${i + 1}Raw`] = v
  })
  return { msgid: 36, msgName: 'SERVO_OUTPUT_RAW', sysid: 1, compid: 1, seq: 0, fields }
}

describe('SERVO_OUTPUT_RAW', () => {
  it('reads sixteen outputs in order, SERVO1 first', () => {
    const values = Array.from({ length: 16 }, (_, i) => 1000 + i)
    expect(messageToDeltas(servoRaw(0, values))).toEqual([
      { k: 'servoOutputs', port: 0, valuesUs: values },
    ])
  })

  it('reads the extension fields a MAVLink 1 sender leaves out as zero', () => {
    // servo9Raw..servo16Raw are extensions; an older sender stops at eight.
    const [delta] = messageToDeltas(servoRaw(0, [1100, 1200, 1300, 1400, 0, 0, 0, 0]))
    expect(delta).toMatchObject({ k: 'servoOutputs', port: 0 })
    expect((delta as { valuesUs: number[] }).valuesUs).toHaveLength(16)
    expect((delta as { valuesUs: number[] }).valuesUs.slice(8)).toEqual(Array(8).fill(0))
  })

  it('ignores a port ArduPilot never sends', () => {
    expect(messageToDeltas(servoRaw(2, [1500]))).toEqual([])
  })
})

describe('mergeServoOutputs', () => {
  // SITL builds with 16 channels and sends only port 0. A board with more
  // than 1 MB of flash builds with 32 and sends port 1 right after it every
  // cycle, usually all zeros.
  it('keeps outputs 1-16 when the port-1 message follows', () => {
    const low = Array.from({ length: 16 }, () => 1000)
    const high = Array(16).fill(0)
    const merged = mergeServoOutputs(mergeServoOutputs([], 0, low), 1, high)
    expect(merged.slice(0, 16)).toEqual(low)
    expect(merged.slice(16)).toEqual(high)
  })

  it('places port 1 at SERVO17', () => {
    const merged = mergeServoOutputs([], 1, [1234])
    expect(merged).toHaveLength(32)
    expect(merged[16]).toBe(1234)
    expect(merged[0]).toBe(0)
  })

  it('does not mutate what it was given', () => {
    const prev = [1500]
    mergeServoOutputs(prev, 0, [1600])
    expect(prev).toEqual([1500])
  })
})

describe('BATTERY_STATUS', () => {
  const U = 0xffff
  const status = (fields: DecodedMessage['fields']): DecodedMessage => ({
    msgid: 147,
    msgName: 'BATTERY_STATUS',
    sysid: 1,
    compid: 1,
    seq: 0,
    fields,
  })

  it('reads a second monitor by its instance, with the wire’s -1s kept', () => {
    const voltages = [12600, U, U, U, U, U, U, U, U, U]
    expect(
      messageToDeltas(
        status({
          id: 1,
          voltages,
          voltagesExt: [0, 0, 0, 0],
          currentBattery: -1,
          batteryRemaining: -1,
        }),
      ),
    ).toEqual([{ k: 'batteryStatus', id: 1, voltageV: 12.6, currentA: -1, remainingPct: -1 }])
  })

  it('adds up a total ArduPilot carried past what one slot holds', () => {
    // 100.4 V: a full first slot and the rest in the next, as
    // `send_battery_status` writes a big pack with no cell readings.
    expect(packVoltage([65534, 34866, U, U, U, U, U, U, U, U], [0, 0, 0, 0])).toBe(100.4)
  })

  it('sums measured cells, the extension included', () => {
    const cells = Array(10).fill(4200)
    expect(packVoltage(cells, [4200, 4200, 0, 0])).toBeCloseTo(50.4)
  })

  it('says nothing was measured rather than zero volts', () => {
    expect(packVoltage(Array(10).fill(U), [0, 0, 0, 0])).toBeNull()
  })
})
