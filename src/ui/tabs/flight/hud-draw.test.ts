import { describe, expect, it } from 'vitest'
import {
  MAV_STATE,
  angleDelta,
  armReadiness,
  batteryLabel,
  compassTicks,
  gpsLabel,
  gpsUsable,
  isFailsafe,
  linkLabel,
  tapeTicks,
  hudMessage,
  HUD_MESSAGE_MS,
} from './hud-draw'
import { SENSOR_BITS } from '../../../protocol/sensors'

const PREARM = SENSOR_BITS.prearm

describe('isFailsafe', () => {
  it('is raised for critical and emergency only', () => {
    expect(isFailsafe(MAV_STATE.critical)).toBe(true)
    expect(isFailsafe(MAV_STATE.emergency)).toBe(true)
  })

  it('is quiet for ordinary operation', () => {
    // A false FAILSAFE on the bench teaches the pilot to ignore it.
    for (const s of [0, 1, 2, MAV_STATE.standby, MAV_STATE.active]) {
      expect(isFailsafe(s), `state ${s}`).toBe(false)
    }
  })
})

describe('armReadiness', () => {
  it('says armed regardless of the prearm bit', () => {
    expect(armReadiness(true, PREARM, 0, PREARM)).toBe('armed')
    expect(armReadiness(true, 0, 0, PREARM)).toBe('armed')
  })

  it('reads the health bit when the vehicle reports one', () => {
    expect(armReadiness(false, PREARM, PREARM, PREARM)).toBe('ready')
    expect(armReadiness(false, PREARM, 0, PREARM)).toBe('notReady')
  })

  it('stays quiet when the vehicle does not report prearm at all', () => {
    // Otherwise a build without the check shows a permanent "Not ready to
    // arm".
    expect(armReadiness(false, 0, 0, PREARM)).toBe('unknown')
  })

  it('is not confused by other sensor bits', () => {
    const others = SENSOR_BITS.gyro | SENSOR_BITS.gps
    expect(armReadiness(false, others, others, PREARM)).toBe('unknown')
    expect(armReadiness(false, others | PREARM, others, PREARM)).toBe('notReady')
  })
})

describe('tapeTicks', () => {
  it('brackets the value with ticks on the step', () => {
    const ticks = tapeTicks(12, 10, 5)
    expect(ticks.map((t) => t.value)).toEqual([5, 10, 15, 20])
  })

  it('places ticks relative to the value, not the tape', () => {
    const ticks = tapeTicks(12, 10, 5)
    expect(ticks.find((t) => t.value === 10)?.offset).toBeCloseTo(-2)
    expect(ticks.find((t) => t.value === 15)?.offset).toBeCloseTo(3)
  })

  it('marks every other tick as major by default', () => {
    const ticks = tapeTicks(0, 20, 5)
    expect(ticks.find((t) => t.value === 10)?.major).toBe(true)
    expect(ticks.find((t) => t.value === 5)?.major).toBe(false)
  })

  it('handles negative values without drifting off the step', () => {
    // Negative values (below launch, descending) must land exactly on ticks.
    const ticks = tapeTicks(-7, 10, 5)
    expect(ticks.map((t) => t.value)).toEqual([-15, -10, -5, 0])
    expect(ticks.find((t) => t.value === -5)?.offset).toBeCloseTo(2)
  })
})

describe('angleDelta', () => {
  it('takes the short way round', () => {
    expect(angleDelta(350, 10)).toBe(20)
    expect(angleDelta(10, 350)).toBe(-20)
    expect(angleDelta(0, 90)).toBe(90)
  })

  it('never returns more than half a turn', () => {
    // The antipode is ambiguous; only the magnitude matters.
    for (const [a, b] of [
      [0, 180],
      [180, 0],
      [45, 225],
    ]) {
      expect(Math.abs(angleDelta(a!, b!))).toBe(180)
    }
  })
})

describe('compassTicks', () => {
  it('names the cardinal points instead of their numbers', () => {
    const at0 = compassTicks(0, 40, 15)
    expect(at0.find((t) => Math.abs(t.offset) < 0.001)?.label).toBe('N')
    const at90 = compassTicks(90, 40, 15)
    expect(at90.find((t) => Math.abs(t.offset) < 0.001)?.label).toBe('E')
  })

  it('wraps across north without a gap or a 360', () => {
    // Pointing north the ribbon reads NW 330 345 N 15 30 NE: continuous
    // across the wrap, with N rather than 360.
    const labels = compassTicks(0, 50, 15).map((t) => t.label)
    expect(labels).toEqual(['NW', '330', '345', 'N', '15', '30', 'NE'])
    expect(labels).not.toContain('360')
  })

  it('keeps every tick inside the requested span', () => {
    for (const heading of [0, 37, 180, 271, 359]) {
      for (const t of compassTicks(heading, 45, 15)) {
        expect(Math.abs(t.offset)).toBeLessThanOrEqual(45)
      }
    }
  })

  it('offsets are relative to the live heading, so the ribbon slides', () => {
    const ticks = compassTicks(37, 45, 15)
    const n = ticks.find((t) => t.label === '30')
    expect(n?.offset).toBeCloseTo(-7)
  })
})

describe('batteryLabel', () => {
  it('shows what the vehicle reports', () => {
    expect(batteryLabel(12.34, 4.2, 87)).toBe('12.3V  4.2A  87%')
  })

  it('leaves out fields the vehicle has no sensor for', () => {
    // Zero current with no current sensor is not a measurement.
    expect(batteryLabel(12.3, 0, 87)).toBe('12.3V  87%')
    expect(batteryLabel(0, 0, -1)).toBe('')
  })

  it('distinguishes no estimate from an empty pack', () => {
    expect(batteryLabel(12.3, 0, -1)).toBe('12.3V')
    expect(batteryLabel(12.3, 0, 0)).toBe('12.3V  0%')
  })
})

describe('linkLabel', () => {
  it('scales receiver RSSI to a percentage', () => {
    expect(linkLabel(254, undefined)).toBe('RSSI 100%')
    expect(linkLabel(127, undefined)).toBe('RSSI 50%')
  })

  it('falls back to the packet rate when the receiver reports no RSSI', () => {
    expect(linkLabel(-1, 24.4)).toBe('24 pkt/s')
  })

  it('shows both when both are available', () => {
    expect(linkLabel(254, 30)).toBe('RSSI 100%  30 pkt/s')
  })

  it('says nothing rather than showing zeros', () => {
    expect(linkLabel(-1, undefined)).toBe('')
    expect(linkLabel(-1, 0)).toBe('')
  })
})

describe('the GPS readout', () => {
  it('names the fix a pilot would name', () => {
    expect(gpsLabel(2, 5)).toBe('GPS: 2D  5 sats')
    expect(gpsLabel(3, 14)).toBe('GPS: 3D  14 sats')
    // RTK is named separately so an RTK setup can be confirmed.
    expect(gpsLabel(5, 20)).toBe('GPS: RTK float  20 sats')
    expect(gpsLabel(6, 20)).toBe('GPS: RTK fixed  20 sats')
  })

  it('leaves the satellite count out until there is one', () => {
    // No satellite count until the receiver reports one.
    expect(gpsLabel(1, 0)).toBe('GPS: No fix')
  })

  it('tells a missing receiver from one that is still searching', () => {
    // GPS_FIX_TYPE 0 (NO_GPS) means no receiver is talking to the autopilot;
    // 1 (NO_FIX) means one is searching. Different causes, different words,
    // as in Mission Planner.
    expect(gpsLabel(0, 0)).toBe('GPS: No GPS')
    expect(gpsLabel(1, 0)).toBe('GPS: No fix')
    // Satellites but no fix means the receiver is still searching.
    expect(gpsLabel(1, 4)).toBe('GPS: No fix  4 sats')
  })

  it('calls a fix usable at exactly the threshold ArduPilot does', () => {
    // Below a 3D fix the vehicle refuses Loiter, Auto and RTL.
    expect(gpsUsable(2)).toBe(false)
    expect(gpsUsable(3)).toBe(true)
    expect(gpsUsable(6)).toBe(true)
  })
})

describe('the message on the HUD', () => {
  const at = 100_000
  const text = (severity: number, s: string, when = at) => ({ severity, text: s, at: when })

  it('shows the vehicle’s latest warning, and not its chatter', () => {
    const texts = [
      text(2, 'PreArm: Need Position Estimate', at - 500),
      text(6, 'Reached waypoint #2'),
    ]
    expect(hudMessage(texts, null, at)).toBe('PreArm: Need Position Estimate')
  })

  it('shows whichever is newer, the vehicle’s warning or the app’s note', () => {
    const texts = [text(4, 'Mode change to Guided failed: requires position', at - 1000)]
    expect(hudMessage(texts, { text: 'RTL: no answer', at }, at)).toBe('RTL: no answer')
    expect(hudMessage(texts, { text: 'RTL: no answer', at: at - 2000 }, at)).toBe(
      'Mode change to Guided failed: requires position',
    )
  })

  it('goes after a few seconds', () => {
    const texts = [text(3, 'Crash: Disarming', at)]
    expect(hudMessage(texts, null, at + HUD_MESSAGE_MS - 1)).toBe('Crash: Disarming')
    expect(hudMessage(texts, null, at + HUD_MESSAGE_MS)).toBeNull()
  })
})
