import { describe, expect, it } from 'vitest'
import { isOsdParam } from './OsdActions'

// What counts as the OSD layout when saving and loading it. Too wide and a
// loaded layout brings someone else's tuning along; too narrow and part of
// the layout is lost.

describe('isOsdParam', () => {
  it('takes the OSD settings and every screen', () => {
    for (const n of [
      'OSD_TYPE',
      'OSD_UNITS',
      'OSD_OPTIONS',
      'OSD_MSG_TIME',
      'OSD1_ENABLE',
      'OSD1_ALTITUDE_EN',
      'OSD1_ALTITUDE_X',
      'OSD1_ALTITUDE_Y',
      'OSD4_TXT_RES',
      'OSD2_BAT_VOLT_EN',
    ]) {
      expect(isOsdParam(n)).toBe(true)
    }
  })

  it('leaves everything else alone', () => {
    // A whole-vehicle file loaded here contributes only its OSD, not PIDs,
    // calibration or failsafes.
    for (const n of [
      'ANGLE_MAX',
      'ATC_ANG_PIT_P',
      'COMPASS_OFS_X',
      'FS_OPTIONS',
      'RC1_TRIM',
      'SERIAL1_PROTOCOL',
    ]) {
      expect(isOsdParam(n)).toBe(false)
    }
  })

  it('does not catch names that merely start with the letters', () => {
    // Only OSD_ and OSD<digit>_, not any name beginning with OSD. ArduPilot
    // has no such parameter today, but the filter should not widen if one
    // appears.
    expect(isOsdParam('OSDX_THING')).toBe(false)
    expect(isOsdParam('OSDIFY')).toBe(false)
    expect(isOsdParam('MY_OSD_THING')).toBe(false)
  })
})
