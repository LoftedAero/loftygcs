// Where the motors are, for a given FRAME_CLASS and FRAME_TYPE.
//
// Drawn rather than borrowed. ArduPilot's own diagrams are on a wiki licensed
// CC BY-SA 3.0, whose ShareAlike terms do not sit cleanly inside a GPL-3.0
// app, and Mission Planner's are bitmaps that would need recolouring for this
// theme. None of that is necessary: a motor layout is *facts* -- a number, an
// angle and which way the propeller turns -- and the facts are in ArduPilot's
// own source, `AP_MotorsMatrix.cpp`. This table is transcribed from it, and
// the frame class and type numbers from `AP_Motors_Class.h`.
//
// Two forms appear there and both are kept faithfully:
//
//   add_motor(num, angle_degrees, yaw_factor, testing_order)
//   add_motor_raw(num, roll_factor, pitch_factor, yaw_factor, testing_order)
//
// The angle form is degrees clockwise from the nose -- checked against the
// quad plus, whose testing order 1 sits at 0 degrees (front) and 2 at 90
// (right). The raw form gives the position as control factors instead, and
// ArduPilot derives those from the angle as `roll = cos(angle + 90)` and
// `pitch = cos(angle)`, so inverting gives right = -roll and forward = pitch.
//
// **Motors are labelled by testing order, not by output number.** That is what
// ArduPilot's diagrams letter, what its motor test spins, and what the Outputs
// tab's own Motor 1..8 buttons drive; the output number is a wiring detail
// that differs per frame and would be the wrong thing to put on a picture
// somebody checks their propellers against.

/**
 * Which way a propeller turns, seen from above.
 *
 * `none` is a real state, not a gap: a V-tail's two front motors carry a yaw
 * factor of 0 -- they provide no yaw torque, the canted tail pair does -- and
 * drawing them with an arrow would claim something the firmware does not.
 */
export type Spin = 'cw' | 'ccw' | 'none'

export interface FrameMotor {
  /**
   * ArduPilot's motor number -- the one `SERVOn_FUNCTION` calls Motor1..12 and
   * the one every wiring diagram is drawn with.
   *
   * **Not the motor test's number**, which is `test` below. The two differ on
   * most frames and agree on a few, which is what made conflating them easy:
   * a quad X motor 2 is the rear *left*, and it is third in the test sequence.
   * `AP_MotorsMatrix` states both -- `add_motor(motor_num, angle, yaw,
   * testing_order)` -- and this table was transcribed from the testing order
   * alone, so every picture numbered its motors in the order they spin rather
   * than the order they are wired.
   */
  n: number
  /**
   * Where it falls in the motor test sequence, counting from 1.
   *
   * Shown as a letter (A, B, C...) wherever it is shown, which is Mission
   * Planner's convention and the thing that keeps it from being read as a
   * motor number.
   */
  test: number
  /**
   * Driven by the motor test but not a propeller.
   *
   * The tricopter's tail servo is step 3 of its test sequence, which is worth
   * drawing precisely because nobody expects a motor test step to swing a
   * servo.
   */
  servo?: true
  /** Right of centre, -1..1. */
  x: number
  /** Forward of centre, -1..1. */
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
 * `add_motor` overload, which converts them with
 * `roll = cos(roll_deg + 90)` and `pitch = cos(pitch_deg)` before handing them
 * to the raw form -- so the position is `sin(roll_deg)` right and
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
  // The V frame's yaw factors are fractional (0.7981), so the spin comes from
  // their sign the way it does for the named constants.
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
 * Not from a motor matrix -- `AP_MotorsTri` has its own class -- but the
 * positions still come from the source rather than from a sketch: the front
 * pair carry roll factors of -1 (right) and +1 (left) with a pitch factor of
 * 0.5, and the rear motor a pitch factor of -1, which is the same
 * right = -roll, forward = pitch mapping the matrix frames use. The rear
 * roll factor is 0 by symmetry, being on the centreline.
 *
 * The propeller directions are the one part here that is *convention* rather
 * than source. `AP_MotorsTri` states none, because yaw is not made by
 * differential torque on a tricopter -- it is the tail servo pivoting, as
 * `_pivot_angle = safe_asin(yaw_thrust)` -- so the firmware does not care
 * which way they turn. They are drawn because a frame of blank motors beside
 * seven frames of arrows reads as a rendering fault, and the counter-rotating
 * front pair is what every tricopter build uses. The numbers are the test sequence's,
 * where 1 is the front right, 2 the back motor, 4 the front left, and step 3
 * is the tail servo -- drawn as a servo, and labelled with the channel it is
 * wired to (CH7) rather than with its step. And the frame type does
 * not apply at all: this class never reaches the matrix, so every type draws
 * the same aircraft.
 */
// `AP_MotorsTri` drives three outputs and skips one: MOT_1 is the right
// motor, MOT_2 the left and **MOT_4 the rear** -- there is no motor 3 on a
// tricopter. Its test sequence is a different order again
// (`_output_test_seq`): 1 right, 2 rear, 3 the tail servo, 4 left.
const TRI_ANY: FrameMotor[] = [
  { n: 1, test: 1, x: 1, y: 0.5, spin: 'ccw' },
  { n: 4, test: 2, x: 0, y: -1, spin: 'cw' },
  // Labelled by its output channel, because it has no motor number at all:
  // `AP_MotorsTri.h` says `#define AP_MOTORS_CH_TRI_YAW CH_7` -- "tail servo
  // uses channel 7" -- and 7 is the number somebody wires to.
  { n: 7, test: 3, x: 0, y: -1, spin: 'none', servo: true },
  { n: 2, test: 4, x: -1, y: 0.5, spin: 'cw' },
]

const CLASSES: Record<number, Record<number, FrameMotor[]>> = {
  // Empty, like Y6's: the layout comes from the fallback below whatever the
  // frame type says.
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
 * Null is the honest answer for the frames this table does not carry --
 * helicopters, tailsitters, single and coaxial copters, the scripting
 * matrices, and the tricopter and V-tail layouts whose geometry comes from a
 * different motors class. A diagram invented for those would be a confident
 * picture of the wrong aircraft.
 */
export function frameLayout(frameClass: number, frameType: number): FrameMotor[] | null {
  const byType = CLASSES[frameClass]
  if (!byType) return null
  const motors = byType[frameType]
  if (motors) return motors
  // Y6 is the one class whose firmware falls back to a default layout for any
  // type it does not name.
  if (frameClass === FRAME_CLASS.Y6) return Y6_DEFAULT
  if (frameClass === FRAME_CLASS.TRI) return TRI_ANY
  return null
}

/**
 * Motors sharing a position, as coaxial frames have.
 *
 * Returned as an index into the list so a drawing can offset the second of
 * each pair instead of hiding it under the first.
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
 * Only a fallback: the vehicle's own parameter metadata names these, and that
 * is what the screen prefers, because a firmware that renames one should not
 * need this file edited. Kept for the case where metadata has not arrived.
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
 * The set changes with the type, which is the point: a hexa has no V layout,
 * so choosing V leaves it out rather than showing a hexa drawn as something
 * it is not. Y6 is always in, because its firmware falls back to one layout
 * for any type it does not name.
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
 * This is the *support* matrix, which is not the same as the drawing table
 * above: a combination can be perfectly valid and still have no picture here
 * (the quad's NYT variants are), but a combination missing from this list is
 * one the firmware refuses. `AP_MotorsMatrix::setup_motors` ends each class in
 * `default: return false`, and a false there sets `_frame_class_string` to
 * "UNSUPPORTED" and `set_initialised_ok(false)` -- the motors never come up and
 * the vehicle will not arm.
 *
 * Y6 is the exception its firmware makes: its switch has a default that builds
 * a layout rather than failing, so every type is valid for it.
 *
 * Classes absent from this table -- helicopters, tricopters, single and coax,
 * tailsitters, the scripting matrices -- never reach the matrix at all
 * (`Copter::allocate_motors` gives them their own motors class), so frame type
 * does not choose their layout and nothing here can be unsupported for them.
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
 * Unknown is not unsupported: a class this table does not carry gets `true`,
 * because a newer firmware may have added one and claiming a working aircraft
 * is misconfigured is the worse error.
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
 * X for everything with arms on the diagonals, and the Y6's own B layout,
 * because those are the shapes people recognise the airframe by.
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
 * The set is constant whatever the type, because a grid that grows and shrinks
 * as somebody arrows down a dropdown is unreadable -- and no tile is ever
 * empty, because a blank square next to a drawn one reads as a pairing that
 * exists and a pairing that does not, which is exactly backwards when the
 * blank one is the aircraft you have selected.
 *
 * A class that does not take the chosen type is drawn in its own canonical
 * type and marked unsupported, so the picture still says what the airframe is
 * without claiming the combination is valid.
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
