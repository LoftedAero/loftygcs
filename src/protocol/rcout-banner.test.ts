import { describe, expect, it } from 'vitest'
import { boardNameFromBanner, groupForChannel, parseRcoutBanner } from './rcout-banner'

// The strings here are what `AP_HAL::RCOutput::append_to_banner` produces --
// `"%s %s:%u-%u"` per run, `"%s %s:%u"` for a lone channel -- not wording
// anyone remembered. SITL cannot produce any of them (only the ChibiOS HAL
// implements the banner), so this is the only place the parser is exercised
// until it meets a real board.

describe('the RCOut boot banner', () => {
  it('reads the runs a board reports', () => {
    const b = parseRcoutBanner('RCOut: PWM:1-4 DShot600:5-8')!
    expect(b.groups).toEqual([
      { mode: 'PWM', low: 1, high: 4 },
      { mode: 'DShot600', low: 5, high: 8 },
    ])
    expect(b.initialising).toBe(false)
  })

  it('reads a lone channel, which carries no range', () => {
    const b = parseRcoutBanner('RCOut: PWM:1-4 DShot600:5 PWM:6-8')!
    expect(b.groups).toEqual([
      { mode: 'PWM', low: 1, high: 4 },
      { mode: 'DShot600', low: 5, high: 5 },
      { mode: 'PWM', low: 6, high: 8 },
    ])
  })

  it('keeps "not ready yet" apart from "nothing configured"', () => {
    expect(parseRcoutBanner('RCOut: Initialising')).toEqual({ groups: [], initialising: true })
    expect(parseRcoutBanner('RCOut: None')).toEqual({ groups: [], initialising: false })
  })

  it('ignores every other line in the feed', () => {
    // The store passes the whole status feed through this, exactly as it does
    // for the Frame: line, so anything else must come back null rather than an
    // empty banner -- an empty one would overwrite a good reading.
    for (const line of [
      'ArduCopter V4.7.1-beta1',
      'Frame: QUAD/PLUS',
      'IMU0: fast sampling enabled 8.0kHz/1.0kHz',
      'EKF3 IMU0 initialised',
    ]) {
      expect(parseRcoutBanner(line)).toBeNull()
    }
  })

  it('takes an unfamiliar mode name at face value', () => {
    // Matching a known list here would drop a protocol added upstream, and the
    // name is ArduPilot's to choose.
    const b = parseRcoutBanner('RCOut: SomethingNew:1-2')!
    expect(b.groups).toEqual([{ mode: 'SomethingNew', low: 1, high: 2 }])
  })

  it('answers which group an output is in', () => {
    const b = parseRcoutBanner('RCOut: PWM:1-4 DShot600:5-8')
    expect(groupForChannel(b, 1)?.mode).toBe('PWM')
    expect(groupForChannel(b, 5)?.mode).toBe('DShot600')
    expect(groupForChannel(b, 9)).toBeNull()
    expect(groupForChannel(null, 1)).toBeNull()
  })
})

describe('the board name in the boot banner', () => {
  it('reads the name off the system-id line', () => {
    expect(boardNameFromBanner('CubeOrange 00340036 3137510B 33393538')).toBe('CubeOrange')
    expect(boardNameFromBanner('MatekH743 001C0035 32385104 20393256')).toBe('MatekH743')
  })

  it('does not take the other banner lines for one', () => {
    // The IOMCU line is the dangerous one: hex words, same shape, and it sits
    // directly above in the same banner.
    for (const line of [
      'IOMCU: 20 1000 12345678',
      'ArduCopter V4.7.1-beta1 (f0a1b2c3)',
      'ChibiOS: 6a85082c',
      'RCOut: PWM:1-4 DShot600:5-8',
      'Frame: QUAD/PLUS',
    ]) {
      expect(boardNameFromBanner(line)).toBeNull()
    }
  })
})
