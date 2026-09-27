import { describe, expect, it } from 'vitest'
import {
  ACCEL_POS,
  ACCEL_POSITIONS,
  isCalibrationFailure,
  isCalibrationSuccess,
  parseAccelPrompt,
  posePrompt,
} from './accel-cal'

// The wizard follows the vehicle's prompts, so a misparsed side tells the
// user to turn the airframe the wrong way.
describe('parseAccelPrompt', () => {
  it("reads every side out of AP_AccelCal's own wording", () => {
    const cases: [string, number][] = [
      ['Place vehicle level and press any key.', ACCEL_POS.LEVEL],
      ['Place vehicle on its LEFT side and press any key.', ACCEL_POS.LEFT],
      ['Place vehicle on its RIGHT side and press any key.', ACCEL_POS.RIGHT],
      ['Place vehicle nose DOWN and press any key.', ACCEL_POS.NOSEDOWN],
      ['Place vehicle nose UP and press any key.', ACCEL_POS.NOSEUP],
      ['Place vehicle on its BACK and press any key.', ACCEL_POS.BACK],
    ]
    for (const [text, expected] of cases) {
      expect(parseAccelPrompt(text)?.value, text).toBe(expected)
    }
  })

  it('does not let "nose DOWN" be claimed by the left/right checks', () => {
    // "DOWN" and "UP" must win over any stray direction word, and the
    // nose cases must not fall through to LEFT/RIGHT.
    expect(parseAccelPrompt('Place vehicle nose DOWN and press any key.')?.id).toBe('NOSEDOWN')
    expect(parseAccelPrompt('Place vehicle nose UP and press any key.')?.id).toBe('NOSEUP')
  })

  it('ignores status lines that are not position prompts', () => {
    expect(parseAccelPrompt('Calibration successful')).toBeNull()
    expect(parseAccelPrompt('EKF3 IMU0 is using GPS')).toBeNull()
    expect(parseAccelPrompt('PreArm: Need Position Estimate')).toBeNull()
    // Mentions a side, but is not asking for one.
    expect(parseAccelPrompt('Compass 2 on the left is unhealthy')).toBeNull()
  })

  it('tolerates case and wording drift', () => {
    expect(parseAccelPrompt('place the vehicle on its left side')?.id).toBe('LEFT')
    expect(parseAccelPrompt('PLACE VEHICLE ON ITS BACK')?.id).toBe('BACK')
  })
})

describe('the pose half of the vehicle prompt', () => {
  it('drops the key it no longer has, and the punctuation with it', () => {
    expect(posePrompt('Place vehicle on its LEFT side and press any key.')).toBe(
      'Place vehicle on its LEFT side',
    )
    expect(posePrompt('Place vehicle level and press any key')).toBe('Place vehicle level')
  })

  it('leaves wording it does not recognize alone', () => {
    // A rephrased prompt is shown whole rather than truncated.
    expect(posePrompt('Put the aircraft on its nose')).toBe('Put the aircraft on its nose')
  })
})

describe('calibration verdicts', () => {
  it('recognizes success and failure lines', () => {
    expect(isCalibrationSuccess('Calibration successful')).toBe(true)
    expect(isCalibrationSuccess('calibration successful!')).toBe(true)
    expect(isCalibrationFailure('Calibration FAILED')).toBe(true)
    expect(isCalibrationFailure('Calibration cancelled')).toBe(true)
    expect(isCalibrationSuccess('Place vehicle level and press any key.')).toBe(false)
    expect(isCalibrationFailure('Calibration successful')).toBe(false)
  })
})

describe('position table', () => {
  it('covers all six sides with the MAVLink enum values', () => {
    expect(ACCEL_POSITIONS.map((p) => p.value)).toEqual([1, 2, 3, 4, 5, 6])
    for (const p of ACCEL_POSITIONS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.instruction.length).toBeGreaterThan(0)
    }
  })
})
