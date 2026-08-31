import { describe, expect, it } from 'vitest'
import { isOsdParam } from './OsdActions'

// What counts as "the OSD layout" when saving and loading it. The filter is
// the whole feature: too wide and loading somebody's screen layout drags
// their tuning along, too narrow and half the layout does not travel.

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
    // The point of the filter: a whole-vehicle file can be loaded here and
    // contribute only its OSD, so borrowing a screen layout cannot bring
    // somebody else's PIDs, calibration or failsafes with it.
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
    // Guards the regex: OSD_ and OSD<digit>_ only, not any word beginning
    // OSD. ArduPilot has no such parameter today, but a filter that would
    // silently widen when one appears is the kind that goes wrong quietly.
    expect(isOsdParam('OSDX_THING')).toBe(false)
    expect(isOsdParam('OSDIFY')).toBe(false)
    expect(isOsdParam('MY_OSD_THING')).toBe(false)
  })
})
