// Which of six attitudes is the vehicle in, and how far has it turned?
//
// Onboard compass calibration wants samples from all around the sphere; the
// usual instruction (Mission Planner's and QGroundControl's) is to hold the
// vehicle in each of six attitudes and spin it about vertical. This measures
// which attitude it is in and how far it has turned there, from ATTITUDE.
//
// Turns are counted from body rates, not Euler yaw: nose-down and tail-down
// are pitch = ±90°, where gimbal lock makes yaw meaningless. The body rate
// vector projected onto body-frame "down" is well defined in every attitude.

export type OrientationId =
  'level' | 'upsideDown' | 'noseDown' | 'tailDown' | 'leftSide' | 'rightSide'

export interface Orientation {
  id: OrientationId
  label: string
  /** What "down" looks like in body frame when the vehicle is held this way. */
  down: readonly [number, number, number]
}

/**
 * The six, in the order they are worked through. Body frame is MAVLink's
 * (X forward, Y right, Z down), so level has earth-down along +Z.
 */
export const ORIENTATIONS: readonly Orientation[] = [
  { id: 'level', label: 'Level', down: [0, 0, 1] },
  { id: 'leftSide', label: 'Left side down', down: [0, -1, 0] },
  { id: 'rightSide', label: 'Right side down', down: [0, 1, 0] },
  { id: 'noseDown', label: 'Nose down', down: [1, 0, 0] },
  // Labeled "Nose up" to pair with "Nose down"; the id stays because the
  // store's turn counts are keyed on it.
  { id: 'tailDown', label: 'Nose up', down: [-1, 0, 0] },
  { id: 'upsideDown', label: 'Upside down', down: [0, 0, -1] },
]

/**
 * Earth's "down" in body frame, from roll and pitch: the third column of the
 * body-to-earth rotation, transposed. Heading does not affect it.
 */
export function downInBody(rollRad: number, pitchRad: number): [number, number, number] {
  return [
    -Math.sin(pitchRad),
    Math.sin(rollRad) * Math.cos(pitchRad),
    Math.cos(rollRad) * Math.cos(pitchRad),
  ]
}

/**
 * How close the vehicle has to be to count as being in an attitude. The six
 * are 90° apart, so 35° is loose enough for a hand-held vehicle without
 * ambiguity.
 */
const TOLERANCE = Math.cos((35 * Math.PI) / 180)

/** Which of the six the vehicle is in, or null if it is between them. */
export function orientationFor(rollRad: number, pitchRad: number): OrientationId | null {
  const g = downInBody(rollRad, pitchRad)
  let best: OrientationId | null = null
  let bestDot = TOLERANCE
  for (const o of ORIENTATIONS) {
    const dot = g[0] * o.down[0] + g[1] * o.down[1] + g[2] * o.down[2]
    if (dot > bestDot) {
      bestDot = dot
      best = o.id
    }
  }
  return best
}

/**
 * Rotation rate about earth vertical in rad/s: the body rate vector projected
 * onto body-frame down. Unsigned, since people do not spin a vehicle in one
 * consistent direction.
 */
export function verticalRate(
  rollRad: number,
  pitchRad: number,
  rates: { rollRateRad: number; pitchRateRad: number; yawRateRad: number },
): number {
  const g = downInBody(rollRad, pitchRad)
  return Math.abs(rates.rollRateRad * g[0] + rates.pitchRateRad * g[1] + rates.yawRateRad * g[2])
}

/**
 * Turns wanted in each attitude before it counts as done. Short of the two
 * the instruction asks for, because the vehicle often has enough samples
 * before then, but still needs a real second rotation.
 */
export const TURNS_REQUIRED = 1.75

/**
 * Ignore rates below this, in rad/s (about 3 deg/s), so gyro noise on a
 * stationary vehicle does not slowly fill a tile.
 */
export const RATE_FLOOR = 0.05
