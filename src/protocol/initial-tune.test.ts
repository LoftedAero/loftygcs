import { describe, expect, it } from 'vitest'
import { gyroFilterHz, hasTunableMotors, initialTuneParams } from './initial-tune'

// Pins the values quoted on ArduPilot's "Setting the Aircraft Up for Tuning",
// so a change to the arithmetic cannot move a number ArduPilot specifies.

const at = (propInches: number, cells: number) => {
  const map = new Map(initialTuneParams({ propInches, cells }).map((v) => [v.param, v.value]))
  return (name: string) => map.get(name)
}

describe('the published anchors', () => {
  it('sets thrust expo per propeller size', () => {
    expect(at(5, 4)('MOT_THST_EXPO')).toBe(0.55)
    expect(at(10, 4)('MOT_THST_EXPO')).toBe(0.65)
    expect(at(20, 4)('MOT_THST_EXPO')).toBe(0.75)
  })

  it('sets the gyro filter per propeller size', () => {
    expect(at(5, 4)('INS_GYRO_FILTER')).toBe(80)
    expect(at(10, 4)('INS_GYRO_FILTER')).toBe(40)
    expect(at(20, 4)('INS_GYRO_FILTER')).toBe(20)
  })

  it('sets the acceleration limits per propeller size', () => {
    expect(at(10, 4)('ATC_ACC_R_MAX')).toBe(1100)
    expect(at(20, 4)('ATC_ACC_P_MAX')).toBe(500)
    expect(at(30, 4)('ATC_ACC_R_MAX')).toBe(200)
    expect(at(10, 4)('ATC_ACC_Y_MAX')).toBe(200)
    expect(at(20, 4)('ATC_ACC_Y_MAX')).toBe(100)
    expect(at(30, 4)('ATC_ACC_Y_MAX')).toBe(90)
  })

  it('offers the quadplane spelling of the same set', () => {
    // A quadplane's VTOL side is Q_M_* and Q_A_*, one for one with MOT_* and ATC_*.
    const v = at(10, 6)
    expect(v('Q_M_BAT_VOLT_MAX')).toBe(v('MOT_BAT_VOLT_MAX'))
    expect(v('Q_M_THST_EXPO')).toBe(v('MOT_THST_EXPO'))
    expect(v('Q_M_SPIN_MAX')).toBe(v('MOT_SPIN_MAX'))
    expect(v('Q_A_ACC_R_MAX')).toBe(v('ATC_ACC_R_MAX'))
    expect(v('Q_A_RAT_RLL_FLTD')).toBe(v('ATC_RAT_RLL_FLTD'))
    expect(v('Q_A_RAT_YAW_FLTE')).toBe(2)
  })

  it('knows which vehicles have motors to tune', () => {
    // A fixed wing has neither family, so the card does not draw at all.
    const copter = new Set(['MOT_THST_EXPO'])
    const quadplane = new Set(['Q_M_THST_EXPO'])
    const fixedWing = new Set(['INS_GYRO_FILTER', 'RLL_RATE_P'])
    expect(hasTunableMotors((p) => copter.has(p))).toBe(true)
    expect(hasTunableMotors((p) => quadplane.has(p))).toBe(true)
    expect(hasTunableMotors((p) => fixedWing.has(p))).toBe(false)
  })

  it('offers both spellings, so either firmware gets the value', () => {
    // Copter 4.7.1 reports ATC_ACC_*_MAX; older builds use ATC_ACCEL_*_MAX.
    const v = at(10, 4)
    expect(v('ATC_ACCEL_R_MAX')).toBe(v('ATC_ACC_R_MAX'))
    expect(v('ATC_ACCEL_P_MAX')).toBe(v('ATC_ACC_P_MAX'))
    expect(v('ATC_ACCEL_Y_MAX')).toBe(v('ATC_ACC_Y_MAX'))
  })

  it('sets the battery range from the cell count', () => {
    // "4.2v x No. Cells" and "3.3v x No. Cells" for standard LiPos.
    expect(at(10, 4)('MOT_BAT_VOLT_MAX')).toBe(16.8)
    expect(at(10, 4)('MOT_BAT_VOLT_MIN')).toBe(13.2)
    expect(at(10, 6)('MOT_BAT_VOLT_MAX')).toBe(25.2)
    expect(at(10, 6)('MOT_BAT_VOLT_MIN')).toBe(19.8)
  })

  it('takes the fixed values the wiki states outright', () => {
    const v = at(10, 4)
    expect(v('INS_ACCEL_FILTER')).toBe(10)
    expect(v('MOT_THST_HOVER')).toBe(0.25)
    expect(v('MOT_SPIN_MAX')).toBe(0.95)
    expect(v('ATC_RAT_YAW_FLTE')).toBe(2)
  })

  it('derives every rate filter from the gyro filter', () => {
    const v = at(10, 4)
    for (const p of [
      'ATC_RAT_RLL_FLTD',
      'ATC_RAT_RLL_FLTT',
      'ATC_RAT_PIT_FLTD',
      'ATC_RAT_PIT_FLTT',
      'ATC_RAT_YAW_FLTT',
    ]) {
      expect(v(p)).toBe(20)
    }
  })
})

describe('between and beyond the anchors', () => {
  it('interpolates rather than jumping at the published sizes', () => {
    const e15 = at(15, 4)('MOT_THST_EXPO')!
    expect(e15).toBeGreaterThan(0.65)
    expect(e15).toBeLessThan(0.75)
    const a15 = at(15, 4)('ATC_ACCEL_R_MAX')!
    expect(a15).toBeGreaterThan(500)
    expect(a15).toBeLessThan(1100)
  })

  it('holds the end values rather than running off the table', () => {
    // Extrapolating past 30in would reach zero and then go negative.
    expect(at(40, 4)('ATC_ACCEL_R_MAX')).toBe(200)
    expect(at(3, 4)('MOT_THST_EXPO')).toBe(0.55)
    expect(at(3, 4)('ATC_ACCEL_R_MAX')).toBe(1100)
  })

  it('keeps the gyro filter law past the end of the table, with a floor', () => {
    // 400/diameter reproduces all three published points exactly.
    expect(gyroFilterHz(8)).toBe(50)
    expect(gyroFilterHz(30)).toBe(13)
    expect(gyroFilterHz(100)).toBe(10)
  })
})
