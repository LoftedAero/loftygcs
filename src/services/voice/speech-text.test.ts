import { describe, expect, it } from 'vitest'
import { DEFAULT_UNITS } from '../../units'
import { clockWords, distanceWords, forSpeech, modeWords } from './speech-text'

describe('words for speech', () => {
  it('spells abbreviations before anything changes case', () => {
    expect(forSpeech('PreArm: GPS 1: Bad fix')).toBe('Pre-arm, G P S 1, Bad fix')
    expect(forSpeech('EKF3 IMU0 is using GPS')).toBe('E K F I M U is using G P S')
    expect(forSpeech('Radio Failsafe - Continuing Auto Mode')).toBe(
      'Radio Failsafe, Continuing Auto Mode',
    )
  })

  it('says units glued to numbers as words', () => {
    expect(forSpeech('Takeoff complete at 20.06m')).toBe('Takeoff complete at 20.06 meters')
    expect(forSpeech('Battery 1 is low 14.0V used 2200 mAh')).toBe(
      'Battery 1 is low 14.0 volts used 2200 milliamp hours',
    )
    expect(forSpeech('Waypoint 4')).toBe('Waypoint 4')
  })

  it('is safe to apply twice', () => {
    const once = forSpeech('PreArm: EKF3 not started, RTL in 10m')
    expect(forSpeech(once)).toBe(once)
  })

  it('drops the # a script uses to ask for speech', () => {
    expect(forSpeech('#Payload released')).toBe('Payload released')
  })

  it('reads mode names the way a pilot says them', () => {
    expect(modeWords('RTL')).toBe('Return to launch')
    expect(modeWords('FBWA')).toBe('Fly by wire A')
    expect(modeWords('QLoiter')).toBe('Q loiter')
    expect(modeWords('Guided_NoGPS')).toBe('Guided no G P S')
    expect(modeWords('Loiter')).toBe('Loiter')
    expect(modeWords('Some_New_Mode')).toBe('Some New Mode')
  })

  it('rounds distances to what an ear can use', () => {
    expect(distanceWords(437, DEFAULT_UNITS)).toBe('440 meters')
    expect(distanceWords(1234, DEFAULT_UNITS)).toBe('1.2 kilometers')
    expect(distanceWords(1000, DEFAULT_UNITS)).toBe('1 kilometer')
    expect(distanceWords(152.4, { ...DEFAULT_UNITS, distance: 'ft' })).toBe('500 feet')
  })

  it('gives bearings relative to the nose as clock positions', () => {
    expect(clockWords(0)).toBe("12 o'clock")
    expect(clockWords(60)).toBe("2 o'clock")
    expect(clockWords(-90)).toBe("9 o'clock")
    expect(clockWords(355)).toBe("12 o'clock")
  })
})
