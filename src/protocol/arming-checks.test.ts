import { describe, expect, it } from 'vitest'
import { checkForReason, checkRows, isSkipped } from './arming-checks'

// Real ArduPilot reasons, filled in from the format strings its AP_Arming and
// vehicle code pass to check_failed(), with the bit of the check that sends
// each. The whole set of 104 fixed-wording formats was checked against the
// source when the table was written; these keep the tricky ones pinned.
const REASONS: [string, number][] = [
  ['Baro: not healthy', 1],
  ['Altitude disparity', 1],
  ['Compass 1 not healthy', 2],
  ['Check mag field: 1200, max 875, min 185', 2],
  ['Compasses inconsistent', 2],
  ['GPS 1: Bad fix', 3],
  ['High GPS HDOP', 3],
  // Sent by the GPS check, although it starts like the INS check's AHRS ones.
  ['AHRS: waiting for home', 3],
  ['GPS and AHRS differ by 12.0m', 3],
  ['AHRS: EKF3 not started', 4],
  ['Gyros not calibrated', 4],
  ['Accels inconsistent', 4],
  ['EKF attitude is bad', 4],
  ['3D Accel calibration needed', 4],
  ['Leaning', 4],
  ['Bad parameter: ANGLE_MAX', 5],
  ['Check FS_THR_VALUE', 5],
  ['Mode channel and RC5_OPTION conflict', 5],
  ['Motor Interlock not configured', 5],
  ['RC not found', 6],
  ['RC3_MIN is greater than RC3_TRIM', 6],
  ['Throttle below failsafe', 6],
  ['Roll radio min too high', 6],
  ['Throttle (RC3) is not neutral', 6],
  ['Radio failsafe on', 6],
  ['Board (4.1v) out of range 4.3-5.8v', 7],
  // Board voltage owns this one; Battery Level owns the rest of "Battery".
  ['Battery failsafe', 7],
  ['Battery 1 below minimum arming voltage', 8],
  ['Airspeed: not healthy', 9],
  ['Logging failed', 10],
  ['No SD card', 10],
  ['Safety Switch', 11],
  ['Main loop slow (300Hz < 400Hz)', 13],
  ['DroneCAN: Node 10 unhealthy', 13],
  ['Mission: Zero takeoff altitude', 14],
  ['Mode requires mission', 14],
  ['No sufficiently close rally point located', 14],
  ['Rangefinder 1: Not Detected', 15],
  ['Mount: not healthy', 16],
  ['Waiting for auxiliary authorisation', 17],
  ['VisOdom: not healthy', 18],
  ['FFT: calibrating noise', 19],
]

describe('checkForReason', () => {
  it.each(REASONS)('puts "%s" under check %i', (reason, bit) => {
    expect(checkForReason(reason)).toBe(bit)
  })

  it('leaves a mandatory or unrecognized reason to Other', () => {
    // Mandatory checks ignore ARMING_SKIPCHK and have no category.
    expect(checkForReason('Hardware safety switch')).toBeNull()
    expect(checkForReason('Something new in a later release')).toBeNull()
  })
})

describe('isSkipped', () => {
  it('reads ARMING_SKIPCHK (4.7 on) as checks to skip, -1 being all', () => {
    expect(isSkipped(16, 1 << 16, undefined)).toBe(true)
    expect(isSkipped(2, 1 << 16, undefined)).toBe(false)
    expect(isSkipped(2, -1, undefined)).toBe(true)
  })

  it('reads ARMING_CHECK (4.6 and older) as checks to run, bit 0 being all', () => {
    expect(isSkipped(2, undefined, 1)).toBe(false)
    expect(isSkipped(2, undefined, 1 << 2)).toBe(false)
    expect(isSkipped(3, undefined, 1 << 2)).toBe(true)
  })

  it('prefers ARMING_SKIPCHK when a firmware reports both', () => {
    expect(isSkipped(2, 0, 0)).toBe(false)
  })

  it('claims nothing before either parameter has downloaded', () => {
    expect(isSkipped(2, undefined, undefined)).toBeNull()
  })
})

describe('checkRows', () => {
  const statuses = (rows: ReturnType<typeof checkRows>) =>
    Object.fromEntries(rows.map((r) => [r.label, r.status]))

  it('lists every check for the vehicle, plus Other, in one fixed set', () => {
    const copter = checkRows([], 'other', 0, undefined, 'ready').map((r) => r.label)
    const plane = checkRows([], 'plane', 0, undefined, 'ready').map((r) => r.label)
    expect(copter).toContain('VisualOdometry')
    expect(copter).not.toContain('Airspeed')
    expect(plane).toContain('Airspeed')
    expect(plane).not.toContain('VisualOdometry')
    expect(copter.at(-1)).toBe('Other')
  })

  it('passes every running check when the vehicle reports ready', () => {
    const rows = checkRows([], 'other', 0, undefined, 'ready')
    expect(rows.every((r) => r.status === 'pass')).toBe(true)
  })

  it('lets the prearm bit outrank a reason sent before the vehicle became ready', () => {
    const late = ['Battery 1 below minimum arming voltage', 'Hardware safety switch']
    for (const readiness of ['ready', 'armed'] as const) {
      const rows = checkRows(late, 'other', 0, undefined, readiness)
      expect(rows.every((r) => r.status === 'pass' && r.reasons.length === 0)).toBe(true)
    }
  })

  it('fails the check a reason belongs to, with the reason attached, and passes the rest', () => {
    const rows = checkRows(
      ['Battery 1 below minimum arming voltage'],
      'other',
      0,
      undefined,
      'notReady',
    )
    const battery = rows.find((r) => r.label === 'Battery Level')!
    expect(battery.status).toBe('fail')
    expect(battery.reasons).toEqual(['Battery 1 below minimum arming voltage'])
    expect(statuses(rows)['Compass']).toBe('pass')
  })

  it('marks a skipped check skipped, even when a reason maps to it', () => {
    const rows = checkRows(['Mount: not healthy'], 'other', 1 << 16, undefined, 'notReady')
    expect(statuses(rows)['Camera']).toBe('skipped')
  })

  it('puts an unrecognized reason under Other rather than losing it', () => {
    const rows = checkRows(['Hardware safety switch'], 'other', 0, undefined, 'notReady')
    const other = rows.find((r) => r.label === 'Other')!
    expect(other.status).toBe('fail')
    expect(other.reasons).toEqual(['Hardware safety switch'])
  })

  it('reads unknown, not pass, when not ready and nothing has been heard', () => {
    const rows = checkRows([], 'other', 0, undefined, 'notReady')
    expect(rows.every((r) => r.status === 'unknown')).toBe(true)
  })
})
