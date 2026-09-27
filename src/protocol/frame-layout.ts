// Where the motors are, for a given FRAME_CLASS and FRAME_TYPE.
//
// Transcribed from ArduPilot's `AP_MotorsMatrix.cpp` (frame class and type
// numbers from `AP_Motors_Class.h`) rather than copied from its wiki diagrams,
// which are CC BY-SA 3.0 and do not sit cleanly inside a GPL-3.0 app. Two
// forms appear there:
//
//   add_motor(num, angle_degrees, yaw_factor, testing_order)
//   add_motor_raw(num, roll_factor, pitch_factor, yaw_factor, testing_order)
//
// The angle form is degrees clockwise from the nose (quad plus: testing order
// 1 at 0 degrees, 2 at 90). The raw form gives control factors, which
// ArduPilot derives as `roll = cos(angle + 90)` and `pitch = cos(angle)`, so
// right = -roll and forward = pitch.

/**
 * Which way a propeller turns, seen from above.
 *
 * `none` is a real state: a V-tail's two front motors carry a yaw factor of 0
 * (the canted tail pair provides the yaw), so they get no arrow.
 */
export type Spin = 'cw' | 'ccw' | 'none'

export interface FrameMotor {
  /**
   * ArduPilot's motor number, the one `SERVOn_FUNCTION` calls Motor1..12 and
   * wiring diagrams use.
   *
   * Not the motor test's number (`test`). The two differ on most frames: quad
   * X motor 2 is the rear left and third in the test sequence.
   */
  n: number
  /**
   * Position in the motor test sequence, from 1. Shown as a letter (A, B,
   * C...), as Mission Planner does, so it is not read as a motor number.
   */
  test: number
  /** Driven by the motor test but not a propeller (the tricopter's tail servo). */
  servo?: true
  /** Right of center, -1..1. */
  x: number
  /** Forward of center, -1..1. */
  y: number
  spin: Spin
}

/** FRAME_CLASS values (AP_Motors_Class.h). */
export const FRAME_CLASS = {
  QUAD: 1,
  HEXA: 2,
  OCTA: 3,
  OCTAQUAD: 4,
  Y6: 5,
  TRI: 7,
  DODECAHEXA: 12,
  DECA: 14,
} as const

/** FRAME_TYPE values (AP_Motors_Class.h). */
export const FRAME_TYPE = {
  PLUS: 0,
  X: 1,
  V: 2,
  H: 3,
  VTAIL: 4,
  ATAIL: 5,
  PLUSREV: 6,
  Y6B: 10,
  Y6F: 11,
  BF_X: 12,
  DJI_X: 13,
  CW_X: 14,
  I: 15,
  BF_X_REV: 18,
  Y4: 19,
  NYT_PLUS: 16,
  NYT_X: 17,
  X_COR: 20,
  CW_X_COR: 21,
} as const

/** `[motor number, testing order, angle degrees clockwise from the nose, spin]`. */
type ByAngle = readonly (readonly [number, number, number, Spin])[]
/** `[motor number, testing order, roll factor, pitch factor, spin]`, as `add_motor_raw`. */
type ByFactors = readonly (readonly [number, number, number, number, Spin])[]

const angled = (rows: ByAngle): FrameMotor[] =>
  rows.map(([n, test, deg, spin]) => {
    const r = (deg * Math.PI) / 180
    return { n, test, x: round(Math.sin(r)), y: round(Math.cos(r)), spin }
  })

const raw = (rows: ByFactors): FrameMotor[] => {
  const out = rows.map(([n, test, roll, pitch, spin]) => ({ n, test, x: -roll, y: pitch, spin }))
  // The factors are control authority, not geometry, so they run past 1 on
  // some frames (Y6 pitches to 1.333). Scale the set, never the motors
  // individually, or the shape changes.
  const scale = Math.max(...out.map((m) => Math.max(Math.abs(m.x), Math.abs(m.y))), 1)
  return out.map((m) => ({ ...m, x: round(m.x / scale), y: round(m.y / scale) }))
}

/**
 * `[testing order, roll degrees, pitch degrees, spin]`, as ArduPilot's third
 * `add_motor` overload, which converts them with `roll = cos(roll_deg + 90)`
 * and `pitch = cos(pitch_deg)`, so the position is `sin(roll_deg)` right and
 * `cos(pitch_deg)` forward.
 */
type ByDegrees = readonly (readonly [number, number, number, number, Spin])[]

const degrees = (rows: ByDegrees): FrameMotor[] => {
  const out = rows.map(([n, test, rollDeg, pitchDeg, spin]) => ({
    n,
    test,
    x: Math.sin((rollDeg * Math.PI) / 180),
    y: Math.cos((pitchDeg * Math.PI) / 180),
    spin,
  }))
  const scale = Math.max(...out.map((m) => Math.max(Math.abs(m.x), Math.abs(m.y))), 1)
  return out.map((m) => ({ ...m, x: round(m.x / scale), y: round(m.y / scale) }))
}

const round = (v: number) => Math.round(v * 1000) / 1000

const QUAD: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [3, 1, 0, 'cw'],
    [1, 2, 90, 'ccw'],
    [4, 3, 180, 'cw'],
    [2, 4, -90, 'ccw'],
  ]),
  [FRAME_TYPE.PLUSREV]: angled([
    [3, 1, 0, 'ccw'],
    [1, 2, 90, 'cw'],
    [4, 3, 180, 'ccw'],
    [2, 4, -90, 'cw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [1, 1, 45, 'ccw'],
    [4, 2, 135, 'cw'],
    [2, 3, -135, 'ccw'],
    [3, 4, -45, 'cw'],
  ]),
  // The V frame's yaw factors are fractional (0.7981); spin is their sign.
  [FRAME_TYPE.V]: angled([
    [1, 1, 45, 'cw'],
    [4, 2, 135, 'ccw'],
    [2, 3, -135, 'cw'],
    [3, 4, -45, 'ccw'],
  ]),
  [FRAME_TYPE.H]: angled([
    [1, 1, 45, 'cw'],
    [4, 2, 135, 'ccw'],
    [2, 3, -135, 'cw'],
    [3, 4, -45, 'ccw'],
  ]),
  [FRAME_TYPE.BF_X]: angled([
    [2, 1, 45, 'ccw'],
    [1, 2, 135, 'cw'],
    [3, 3, -135, 'ccw'],
    [4, 4, -45, 'cw'],
  ]),
  [FRAME_TYPE.BF_X_REV]: angled([
    [2, 1, 45, 'cw'],
    [1, 2, 135, 'ccw'],
    [3, 3, -135, 'cw'],
    [4, 4, -45, 'ccw'],
  ]),
  [FRAME_TYPE.DJI_X]: angled([
    [1, 1, 45, 'ccw'],
    [4, 2, 135, 'cw'],
    [3, 3, -135, 'ccw'],
    [2, 4, -45, 'cw'],
  ]),
  [FRAME_TYPE.CW_X]: angled([
    [1, 1, 45, 'ccw'],
    [2, 2, 135, 'cw'],
    [3, 3, -135, 'ccw'],
    [4, 4, -45, 'cw'],
  ]),
  // Two front motors with no yaw authority and a canted pair at the tail,
  // which is why these need the degrees form and a `none` spin.
  [FRAME_TYPE.VTAIL]: degrees([
    [1, 1, 60, 60, 'none'],
    [4, 2, 0, 160, 'ccw'],
    [2, 3, 0, -160, 'cw'],
    [3, 4, -60, -60, 'none'],
  ]),
  [FRAME_TYPE.ATAIL]: degrees([
    [1, 1, 60, 60, 'none'],
    [4, 2, 0, 160, 'cw'],
    [2, 3, 0, -160, 'ccw'],
    [3, 4, -60, -60, 'none'],
  ]),
  [FRAME_TYPE.Y4]: raw([
    [1, 1, -1, 1, 'ccw'],
    [2, 2, 0, -1, 'cw'],
    [3, 3, 0, -1, 'ccw'],
    [4, 4, 1, 1, 'cw'],
  ]),
}

const HEXA: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [1, 1, 0, 'cw'],
    [4, 2, 60, 'ccw'],
    [6, 3, 120, 'cw'],
    [2, 4, 180, 'ccw'],
    [3, 5, -120, 'cw'],
    [5, 6, -60, 'ccw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [5, 1, 30, 'ccw'],
    [1, 2, 90, 'cw'],
    [4, 3, 150, 'ccw'],
    [6, 4, -150, 'cw'],
    [2, 5, -90, 'ccw'],
    [3, 6, -30, 'cw'],
  ]),
  [FRAME_TYPE.H]: raw([
    [5, 1, -1, 1, 'ccw'],
    [1, 2, -1, 0, 'cw'],
    [4, 3, -1, -1, 'ccw'],
    [6, 4, 1, -1, 'cw'],
    [2, 5, 1, 0, 'ccw'],
    [3, 6, 1, 1, 'cw'],
  ]),
  [FRAME_TYPE.DJI_X]: angled([
    [1, 1, 30, 'ccw'],
    [6, 2, 90, 'cw'],
    [5, 3, 150, 'ccw'],
    [4, 4, -150, 'cw'],
    [3, 5, -90, 'ccw'],
    [2, 6, -30, 'cw'],
  ]),
  [FRAME_TYPE.CW_X]: angled([
    [1, 1, 30, 'ccw'],
    [2, 2, 90, 'cw'],
    [3, 3, 150, 'ccw'],
    [4, 4, -150, 'cw'],
    [5, 5, -90, 'ccw'],
    [6, 6, -30, 'cw'],
  ]),
}

const OCTA: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [1, 1, 0, 'cw'],
    [3, 2, 45, 'ccw'],
    [8, 3, 90, 'cw'],
    [4, 4, 135, 'ccw'],
    [2, 5, 180, 'cw'],
    [6, 6, -135, 'ccw'],
    [7, 7, -90, 'cw'],
    [5, 8, -45, 'ccw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [1, 1, 22.5, 'cw'],
    [3, 2, 67.5, 'ccw'],
    [8, 3, 112.5, 'cw'],
    [4, 4, 157.5, 'ccw'],
    [2, 5, -157.5, 'cw'],
    [6, 6, -112.5, 'ccw'],
    [7, 7, -67.5, 'cw'],
    [5, 8, -22.5, 'ccw'],
  ]),
  [FRAME_TYPE.DJI_X]: angled([
    [1, 1, 22.5, 'ccw'],
    [8, 2, 67.5, 'cw'],
    [7, 3, 112.5, 'ccw'],
    [6, 4, 157.5, 'cw'],
    [5, 5, -157.5, 'ccw'],
    [4, 6, -112.5, 'cw'],
    [3, 7, -67.5, 'ccw'],
    [2, 8, -22.5, 'cw'],
  ]),
  [FRAME_TYPE.CW_X]: angled([
    [1, 1, 22.5, 'ccw'],
    [2, 2, 67.5, 'cw'],
    [3, 3, 112.5, 'ccw'],
    [4, 4, 157.5, 'cw'],
    [5, 5, -157.5, 'ccw'],
    [6, 6, -112.5, 'cw'],
    [7, 7, -67.5, 'ccw'],
    [8, 8, -22.5, 'cw'],
  ]),
  [FRAME_TYPE.V]: raw([
    [7, 1, -1, 1, 'cw'],
    [6, 2, -0.83, 0.34, 'ccw'],
    [2, 3, -0.67, -0.32, 'cw'],
    [4, 4, -0.5, -1, 'ccw'],
    [8, 5, 0.5, -1, 'cw'],
    [3, 6, 0.67, -0.32, 'ccw'],
    [1, 7, 0.83, 0.34, 'cw'],
    [5, 8, 1, 1, 'ccw'],
  ]),
  [FRAME_TYPE.H]: raw([
    [1, 1, -1, 1, 'cw'],
    [3, 2, -1, 0.333, 'ccw'],
    [8, 3, -1, -0.333, 'cw'],
    [4, 4, -1, -1, 'ccw'],
    [2, 5, 1, -1, 'cw'],
    [6, 6, 1, -0.333, 'ccw'],
    [7, 7, 1, 0.333, 'cw'],
    [5, 8, 1, 1, 'ccw'],
  ]),
  [FRAME_TYPE.I]: raw([
    [2, 1, -0.333, 1, 'cw'],
    [6, 2, -1, 1, 'ccw'],
    [7, 3, -1, -1, 'cw'],
    [5, 4, -0.333, -1, 'ccw'],
    [1, 5, 0.333, -1, 'cw'],
    [3, 6, 1, -1, 'ccw'],
    [8, 7, 1, 1, 'cw'],
    [4, 8, 0.333, 1, 'ccw'],
  ]),
}

/** Eight motors on four arms: the pairs sit at the same place, one over one. */
const OCTAQUAD: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [1, 1, 0, 'ccw'],
    [6, 2, 0, 'cw'],
    [4, 3, 90, 'cw'],
    [7, 4, 90, 'ccw'],
    [3, 5, 180, 'ccw'],
    [8, 6, 180, 'cw'],
    [2, 7, -90, 'cw'],
    [5, 8, -90, 'ccw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [1, 1, 45, 'ccw'],
    [6, 2, 45, 'cw'],
    [4, 3, 135, 'cw'],
    [7, 4, 135, 'ccw'],
    [3, 5, -135, 'ccw'],
    [8, 6, -135, 'cw'],
    [2, 7, -45, 'cw'],
    [5, 8, -45, 'ccw'],
  ]),
  [FRAME_TYPE.V]: angled([
    [1, 1, 45, 'cw'],
    [6, 2, 45, 'ccw'],
    [4, 3, 135, 'ccw'],
    [7, 4, 135, 'cw'],
    [3, 5, -135, 'cw'],
    [8, 6, -135, 'ccw'],
    [2, 7, -45, 'ccw'],
    [5, 8, -45, 'cw'],
  ]),
  [FRAME_TYPE.H]: angled([
    [1, 1, 45, 'cw'],
    [6, 2, 45, 'ccw'],
    [4, 3, 135, 'ccw'],
    [7, 4, 135, 'cw'],
    [3, 5, -135, 'cw'],
    [8, 6, -135, 'ccw'],
    [2, 7, -45, 'ccw'],
    [5, 8, -45, 'cw'],
  ]),
  [FRAME_TYPE.CW_X]: angled([
    [1, 1, 45, 'ccw'],
    [2, 2, 45, 'cw'],
    [3, 3, 135, 'cw'],
    [4, 4, 135, 'ccw'],
    [5, 5, -135, 'ccw'],
    [6, 6, -135, 'cw'],
    [7, 7, -45, 'cw'],
    [8, 8, -45, 'ccw'],
  ]),
  [FRAME_TYPE.BF_X]: angled([
    [2, 1, 45, 'ccw'],
    [6, 2, 45, 'cw'],
    [1, 3, 135, 'cw'],
    [5, 4, 135, 'ccw'],
    [3, 5, -135, 'ccw'],
    [7, 6, -135, 'cw'],
    [4, 7, -45, 'cw'],
    [8, 8, -45, 'ccw'],
  ]),
  [FRAME_TYPE.BF_X_REV]: angled([
    [2, 1, 45, 'cw'],
    [6, 2, 45, 'ccw'],
    [1, 3, 135, 'ccw'],
    [5, 4, 135, 'cw'],
    [3, 5, -135, 'cw'],
    [7, 6, -135, 'ccw'],
    [4, 7, -45, 'ccw'],
    [8, 8, -45, 'cw'],
  ]),
  // Co-rotating: both propellers on an arm turn the same way.
  [FRAME_TYPE.X_COR]: angled([
    [1, 1, 45, 'ccw'],
    [6, 2, 45, 'ccw'],
    [4, 3, 135, 'cw'],
    [7, 4, 135, 'cw'],
    [3, 5, -135, 'ccw'],
    [8, 6, -135, 'ccw'],
    [2, 7, -45, 'cw'],
    [5, 8, -45, 'cw'],
  ]),
  [FRAME_TYPE.CW_X_COR]: angled([
    [1, 1, 45, 'ccw'],
    [2, 2, 45, 'ccw'],
    [3, 3, 135, 'cw'],
    [4, 4, 135, 'cw'],
    [5, 5, -135, 'ccw'],
    [6, 6, -135, 'ccw'],
    [7, 7, -45, 'cw'],
    [8, 8, -45, 'cw'],
  ]),
}

/** Three arms, two motors on each. */
const Y6: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.Y6B]: raw([
    [1, 1, -1, 0.5, 'cw'],
    [2, 2, -1, 0.5, 'ccw'],
    [3, 3, 0, -1, 'cw'],
    [4, 4, 0, -1, 'ccw'],
    [5, 5, 1, 0.5, 'cw'],
    [6, 6, 1, 0.5, 'ccw'],
  ]),
  [FRAME_TYPE.Y6F]: raw([
    [2, 1, -1, 0.5, 'ccw'],
    [5, 2, -1, 0.5, 'cw'],
    [1, 3, 0, -1, 'ccw'],
    [4, 4, 0, -1, 'cw'],
    [3, 5, 1, 0.5, 'ccw'],
    [6, 6, 1, 0.5, 'cw'],
  ]),
}

/** Y6's own default, used for any frame type it does not name. */
const Y6_DEFAULT = raw([
  [1, 1, -1, 0.666, 'cw'],
  [2, 2, -1, 0.666, 'ccw'],
  [3, 3, 0, -1.333, 'ccw'],
  [4, 4, 0, -1.333, 'cw'],
  [5, 5, 1, 0.666, 'cw'],
  [6, 6, 1, 0.666, 'ccw'],
])

const DECA: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [1, 1, 0, 'ccw'],
    [2, 2, 36, 'cw'],
    [3, 3, 72, 'ccw'],
    [4, 4, 108, 'cw'],
    [5, 5, 144, 'ccw'],
    [6, 6, 180, 'cw'],
    [7, 7, -144, 'ccw'],
    [8, 8, -108, 'cw'],
    [9, 9, -72, 'ccw'],
    [10, 10, -36, 'cw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [1, 1, 18, 'ccw'],
    [2, 2, 54, 'cw'],
    [3, 3, 90, 'ccw'],
    [4, 4, 126, 'cw'],
    [5, 5, 162, 'ccw'],
    [6, 6, -162, 'cw'],
    [7, 7, -126, 'ccw'],
    [8, 8, -90, 'cw'],
    [9, 9, -54, 'ccw'],
    [10, 10, -18, 'cw'],
  ]),
}
// X and CW_X share one body in the firmware's deca switch.
DECA[FRAME_TYPE.CW_X] = DECA[FRAME_TYPE.X]!

/** Six arms, two motors on each. */
const DODECAHEXA: Record<number, FrameMotor[]> = {
  [FRAME_TYPE.PLUS]: angled([
    [1, 1, 0, 'ccw'],
    [2, 2, 0, 'cw'],
    [3, 3, 60, 'cw'],
    [4, 4, 60, 'ccw'],
    [5, 5, 120, 'ccw'],
    [6, 6, 120, 'cw'],
    [7, 7, 180, 'cw'],
    [8, 8, 180, 'ccw'],
    [9, 9, -120, 'ccw'],
    [10, 10, -120, 'cw'],
    [11, 11, -60, 'cw'],
    [12, 12, -60, 'ccw'],
  ]),
  [FRAME_TYPE.X]: angled([
    [1, 1, 30, 'ccw'],
    [2, 2, 30, 'cw'],
    [3, 3, 90, 'cw'],
    [4, 4, 90, 'ccw'],
    [5, 5, 150, 'ccw'],
    [6, 6, 150, 'cw'],
    [7, 7, -150, 'cw'],
    [8, 8, -150, 'ccw'],
    [9, 9, -90, 'ccw'],
    [10, 10, -90, 'cw'],
    [11, 11, -30, 'cw'],
    [12, 12, -30, 'ccw'],
  ]),
}

/**
 * The tricopter: two front arms and a rear arm whose motor pivots.
 *
 * `AP_MotorsTri` is its own class, not a matrix. The front pair carry roll
 * factors of -1 (right) and +1 (left) with pitch 0.5, the rear motor pitch -1,
 * mapped the same way as the matrix frames.
 *
 * Propeller directions are convention, not source: yaw comes from the tail
 * servo (`_pivot_angle = safe_asin(yaw_thrust)`), so the firmware does not
 * care which way they turn. The counter-rotating front pair is what tricopter
 * builds use. Frame type does not apply; every type draws the same aircraft.
 */
// `AP_MotorsTri` drives MOT_1 (right), MOT_2 (left) and MOT_4 (rear); there is
// no motor 3. Its test sequence (`_output_test_seq`) is 1 right, 2 rear, 3 the
// tail servo, 4 left.
const TRI_ANY: FrameMotor[] = [
  { n: 1, test: 1, x: 1, y: 0.5, spin: 'ccw' },
  { n: 4, test: 2, x: 0, y: -1, spin: 'cw' },
  // Labeled by its output channel, since it has no motor number:
  // `AP_MotorsTri.h` defines `AP_MOTORS_CH_TRI_YAW CH_7`.
  { n: 7, test: 3, x: 0, y: -1, spin: 'none', servo: true },
  { n: 2, test: 4, x: -1, y: 0.5, spin: 'cw' },
]

const CLASSES: Record<number, Record<number, FrameMotor[]>> = {
  // Empty: the layout comes from the fallback in frameLayout for any type.
  [FRAME_CLASS.TRI]: {},
  [FRAME_CLASS.QUAD]: QUAD,
  [FRAME_CLASS.HEXA]: HEXA,
  [FRAME_CLASS.OCTA]: OCTA,
  [FRAME_CLASS.OCTAQUAD]: OCTAQUAD,
  [FRAME_CLASS.Y6]: Y6,
  [FRAME_CLASS.DECA]: DECA,
  [FRAME_CLASS.DODECAHEXA]: DODECAHEXA,
}

/**
 * The motors for this frame, or null when there is no picture to draw.
 *
 * Null for frames this table does not carry: helicopters, tailsitters, single
 * and coaxial copters, and the scripting matrices.
 */
export function frameLayout(frameClass: number, frameType: number): FrameMotor[] | null {
  const byType = CLASSES[frameClass]
  if (!byType) return null
  const motors = byType[frameType]
  if (motors) return motors
  // Y6 firmware falls back to a default layout for any type it does not name.
  if (frameClass === FRAME_CLASS.Y6) return Y6_DEFAULT
  if (frameClass === FRAME_CLASS.TRI) return TRI_ANY
  return null
}

/**
 * Motors sharing a position, as coaxial frames have.
 *
 * Returns each motor's rank at its position so a drawing can offset the
 * second of each pair.
 */
export function coaxialRank(motors: readonly FrameMotor[]): number[] {
  const seen = new Map<string, number>()
  return motors.map((m) => {
    const key = `${m.x},${m.y}`
    const rank = seen.get(key) ?? 0
    seen.set(key, rank + 1)
    return rank
  })
}

/**
 * What ArduPilot calls each class we can draw.
 *
 * A fallback for when parameter metadata, which the screen prefers, has not
 * arrived.
 */
export const FRAME_CLASS_NAMES: Record<number, string> = {
  [FRAME_CLASS.QUAD]: 'Quad',
  [FRAME_CLASS.HEXA]: 'Hexa',
  [FRAME_CLASS.OCTA]: 'Octa',
  [FRAME_CLASS.OCTAQUAD]: 'OctaQuad',
  [FRAME_CLASS.Y6]: 'Y6',
  [FRAME_CLASS.TRI]: 'Tri',
  [FRAME_CLASS.DODECAHEXA]: 'DodecaHexa',
  [FRAME_CLASS.DECA]: 'Deca',
}

/**
 * Every frame class that has a picture for this frame type, in class order.
 *
 * A hexa has no V layout, so choosing V leaves it out. Y6 is always in,
 * because its firmware has a default layout.
 */
export function classesForType(frameType: number): number[] {
  return Object.keys(CLASSES)
    .map(Number)
    .filter((c) => frameLayout(c, frameType) !== null)
    .sort((a, b) => a - b)
}

/**
 * Which frame types each class actually accepts, from ArduPilot's own switch.
 *
 * Separate from the drawing table: a valid combination may have no picture
 * (the quad's NYT variants), but one missing here is refused.
 * `AP_MotorsMatrix::setup_motors` ends each class in `default: return false`,
 * which marks the frame "UNSUPPORTED"; the motors never initialize and the
 * vehicle will not arm. Y6's switch has a default layout, so every type is
 * valid for it.
 *
 * Classes absent here (helicopters, tricopters, single and coax, tailsitters,
 * the scripting matrices) get their own motors class and never reach the
 * matrix, so frame type cannot be unsupported for them.
 */
const SUPPORTED: Record<number, ReadonlySet<number> | 'any'> = {
  [FRAME_CLASS.QUAD]: new Set([
    FRAME_TYPE.PLUS,
    FRAME_TYPE.X,
    FRAME_TYPE.NYT_PLUS,
    FRAME_TYPE.NYT_X,
    FRAME_TYPE.BF_X,
    FRAME_TYPE.BF_X_REV,
    FRAME_TYPE.DJI_X,
    FRAME_TYPE.CW_X,
    FRAME_TYPE.V,
    FRAME_TYPE.H,
    FRAME_TYPE.VTAIL,
    FRAME_TYPE.ATAIL,
    FRAME_TYPE.PLUSREV,
    FRAME_TYPE.Y4,
  ]),
  [FRAME_CLASS.HEXA]: new Set([
    FRAME_TYPE.PLUS,
    FRAME_TYPE.X,
    FRAME_TYPE.H,
    FRAME_TYPE.DJI_X,
    FRAME_TYPE.CW_X,
  ]),
  [FRAME_CLASS.OCTA]: new Set([
    FRAME_TYPE.PLUS,
    FRAME_TYPE.X,
    FRAME_TYPE.V,
    FRAME_TYPE.H,
    FRAME_TYPE.I,
    FRAME_TYPE.DJI_X,
    FRAME_TYPE.CW_X,
  ]),
  [FRAME_CLASS.OCTAQUAD]: new Set([
    FRAME_TYPE.PLUS,
    FRAME_TYPE.X,
    FRAME_TYPE.V,
    FRAME_TYPE.H,
    FRAME_TYPE.CW_X,
    FRAME_TYPE.BF_X,
    FRAME_TYPE.BF_X_REV,
    FRAME_TYPE.X_COR,
    FRAME_TYPE.CW_X_COR,
  ]),
  [FRAME_CLASS.DODECAHEXA]: new Set([FRAME_TYPE.PLUS, FRAME_TYPE.X]),
  [FRAME_CLASS.DECA]: new Set([FRAME_TYPE.PLUS, FRAME_TYPE.X, FRAME_TYPE.CW_X]),
  [FRAME_CLASS.Y6]: 'any',
}

/**
 * Will this firmware build motors for this pairing?
 *
 * A class this table does not carry gets `true`: newer firmware may have
 * added it, and calling a working aircraft misconfigured is the worse error.
 */
export function frameTypeSupported(frameClass: number, frameType: number): boolean {
  const types = SUPPORTED[frameClass]
  if (types === undefined) return true
  if (types === 'any') return true
  return types.has(frameType)
}

/**
 * The type each class is drawn in when the chosen one does not apply to it.
 *
 * X for everything with diagonal arms and B for the Y6, the shapes people
 * recognize the airframe by.
 */
const CANONICAL: Record<number, number> = {
  [FRAME_CLASS.QUAD]: FRAME_TYPE.X,
  [FRAME_CLASS.HEXA]: FRAME_TYPE.X,
  [FRAME_CLASS.OCTA]: FRAME_TYPE.X,
  [FRAME_CLASS.OCTAQUAD]: FRAME_TYPE.X,
  [FRAME_CLASS.Y6]: FRAME_TYPE.Y6B,
  [FRAME_CLASS.TRI]: FRAME_TYPE.PLUS,
  [FRAME_CLASS.DODECAHEXA]: FRAME_TYPE.X,
  [FRAME_CLASS.DECA]: FRAME_TYPE.X,
}

export interface FrameTile {
  frameClass: number
  /** Always something to draw. */
  motors: FrameMotor[]
  /** The type actually drawn, which is not the chosen one for an unsupported pair. */
  drawnType: number
  /** Whether the firmware accepts this class with the chosen type. */
  supported: boolean
}

/**
 * Every class we can picture, for a table that does not change size.
 *
 * The set is constant whatever the type, so the grid does not reflow while
 * someone arrows through a dropdown, and no tile is empty. A class that does
 * not take the chosen type is drawn in its canonical type and marked
 * unsupported.
 */
export function frameTiles(frameType: number): FrameTile[] {
  const out: FrameTile[] = []
  for (const key of Object.keys(CLASSES)) {
    const frameClass = Number(key)
    const supported = frameTypeSupported(frameClass, frameType)
    const chosen = supported ? frameLayout(frameClass, frameType) : null
    const drawnType = chosen ? frameType : (CANONICAL[frameClass] ?? FRAME_TYPE.X)
    const motors = chosen ?? frameLayout(frameClass, drawnType)
    if (motors) out.push({ frameClass, motors, drawnType, supported })
  }
  return out.sort((a, b) => a.frameClass - b.frameClass)
}
