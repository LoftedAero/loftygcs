import { describe, expect, it } from 'vitest'
import { isPrearmMessage, prearmFailures } from './prearm'

// The strings are ArduPilot's own wording, taken from what SITL emits and
// from AP_Arming's messages, not invented for the test.
const NOW = 1_000_000

const msg = (text: string, agoMs: number) => ({ text, at: NOW - agoMs })

describe('recognizing a prearm message', () => {
  it('takes both prefixes ArduPilot uses', () => {
    // "PreArm" runs continuously while disarmed; "Arm" only fails at the
    // moment of the attempt. Both answer the same question.
    expect(isPrearmMessage('PreArm: Compass not calibrated')).toBe(true)
    expect(isPrearmMessage('Arm: Motors Emergency Stopped')).toBe(true)
    expect(isPrearmMessage('prearm: gps')).toBe(true)
  })

  it('leaves the rest of the feed alone', () => {
    expect(isPrearmMessage('EKF3 IMU0 is using GPS')).toBe(false)
    expect(isPrearmMessage('Arming motors')).toBe(false)
    expect(isPrearmMessage('Field Elevation Set: 584m')).toBe(false)
  })
})

describe('distilling the feed into reasons', () => {
  it('strips the prefix and keeps the reason', () => {
    const out = prearmFailures([msg('PreArm: Compass not calibrated', 1000)], NOW)
    expect(out).toEqual([{ reason: 'Compass not calibrated', at: NOW - 1000 }])
  })

  it('collapses the repeats ArduPilot sends every thirty seconds', () => {
    // The same check failing four times is one thing wrong, not four.
    const out = prearmFailures(
      [
        msg('PreArm: GPS horizontal speed error', 90000),
        msg('PreArm: GPS horizontal speed error', 60000),
        msg('PreArm: GPS horizontal speed error', 30000),
        msg('PreArm: GPS horizontal speed error', 1000),
      ],
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.at).toBe(NOW - 1000)
  })

  it('shows several distinct reasons, newest first', () => {
    const out = prearmFailures(
      [
        msg('PreArm: Compass not calibrated', 5000),
        msg('PreArm: Battery below minimum arming voltage', 1000),
      ],
      NOW,
    )
    expect(out.map((f) => f.reason)).toEqual([
      'Battery below minimum arming voltage',
      'Compass not calibrated',
    ])
  })

  it('ages out a reason that has stopped being reported', () => {
    // ArduPilot repeats a failing check while it fails, so silence means it
    // passed. Leaving a fixed problem on screen is how a checklist becomes
    // something people learn to ignore.
    const out = prearmFailures(
      [msg('PreArm: Compass not calibrated', 120000), msg('PreArm: Waiting for GPS config', 2000)],
      NOW,
    )
    expect(out.map((f) => f.reason)).toEqual(['Waiting for GPS config'])
  })

  it('is empty when nothing is wrong', () => {
    expect(prearmFailures([msg('EKF3 IMU0 is using GPS', 100)], NOW)).toEqual([])
    expect(prearmFailures([], NOW)).toEqual([])
  })

  it('ignores a prefix with nothing after it', () => {
    expect(prearmFailures([msg('PreArm:', 100)], NOW)).toEqual([])
  })
})
