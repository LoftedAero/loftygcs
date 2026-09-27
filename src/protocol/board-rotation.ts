// How the autopilot board is mounted, as roll/pitch/yaw.
//
// AHRS_ORIENTATION is ArduPilot's `enum Rotation`, each name a set of Euler
// angles in its 3-2-1 convention. The table is copied from the firmware's own
// test (`AP_Math/tests/test_rotations.cpp`, `TestEulers`) rather than read off
// the names: ROTATION_ROLL_90_PITCH_68_YAW_293 is actually 68.8 and 293.3.
//
// Values 0..43 are consecutive and double as frame indices in the
// pre-rendered board sheet (`npm run cal-art`).

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
 * The mounting rotation for an AHRS_ORIENTATION value, or null for one with
 * no fixed angles. The custom rotations (100-102) take theirs from
 * parameters, which a pre-rendered picture cannot show.
 */
export function boardRotation(value: number): BoardRotation | null {
  const e = Number.isInteger(value) ? EULER[value] : undefined
  return e ? { roll: rad(e[0]), pitch: rad(e[1]), yaw: rad(e[2]) } : null
}
