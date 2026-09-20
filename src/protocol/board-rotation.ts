// How the autopilot board is mounted, as roll/pitch/yaw.
//
// AHRS_ORIENTATION is ArduPilot's `enum Rotation`, and every name is a set of
// Euler angles in its own 3-2-1 convention. The table is copied from the
// firmware's own test (`AP_Math/tests/test_rotations.cpp`, `TestEulers`),
// which checks each name against `from_euler(roll, pitch, yaw)` -- so it is the
// firmware's definition rather than a reading of the names. That matters for
// one entry in particular: ROTATION_ROLL_90_PITCH_68_YAW_293 is actually
// 68.8 and 293.3, which no amount of reading the name would give you.
//
// Values 0..43 are consecutive and are the frame order of the pre-rendered
// board sheet (`npm run cal-art`), which is why a value doubles as its frame.

/** Degrees: [roll, pitch, yaw], indexed by the enum value. */
const EULER: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, 0, 45],
  [0, 0, 90],
  [0, 0, 135],
  [0, 0, 180],
  [0, 0, 225],
  [0, 0, 270],
  [0, 0, 315],
  [180, 0, 0],
  [180, 0, 45],
  [180, 0, 90],
  [180, 0, 135],
  [0, 180, 0],
  [180, 0, 225],
  [180, 0, 270],
  [180, 0, 315],
  [90, 0, 0],
  [90, 0, 45],
  [90, 0, 90],
  [90, 0, 135],
  [270, 0, 0],
  [270, 0, 45],
  [270, 0, 90],
  [270, 0, 135],
  [0, 90, 0],
  [0, 270, 0],
  [0, 180, 90],
  [0, 180, 270],
  [90, 90, 0],
  [180, 90, 0],
  [270, 90, 0],
  [90, 180, 0],
  [270, 180, 0],
  [90, 270, 0],
  [180, 270, 0],
  [270, 270, 0],
  [90, 180, 90],
  [90, 0, 270],
  [90, 68.8, 293.3],
  [0, 315, 0],
  [90, 315, 0],
  [0, 7, 0],
  [45, 0, 0],
  [315, 0, 0],
]

/** How many fixed rotations there are, and so how many frames the sheet has. */
export const ROTATION_COUNT = EULER.length

export interface BoardRotation {
  /** Radians, ArduPilot sense: roll right positive, pitch up positive, yaw clockwise. */
  roll: number
  pitch: number
  yaw: number
}

const rad = (d: number) => (d * Math.PI) / 180

/**
 * The mounting rotation for an AHRS_ORIENTATION value, or null for one that
 * has no fixed angles -- the custom rotations (100-102) take theirs from
 * parameters, and a pre-rendered picture cannot show an arbitrary angle, so
 * drawing one level would be a confident picture of a mounting nobody chose.
 */
export function boardRotation(value: number): BoardRotation | null {
  const e = Number.isInteger(value) ? EULER[value] : undefined
  return e ? { roll: rad(e[0]), pitch: rad(e[1]), yaw: rad(e[2]) } : null
}
