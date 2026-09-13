// Which of six attitudes is the vehicle in, and how far has it turned?
//
// Onboard compass calibration wants magnetic samples from all around the
// sphere, and the way people actually achieve that is Mission Planner's and
// QGroundControl's instruction: hold the vehicle in each of six attitudes and
// spin it about vertical. This module is the measurement behind that --
// which attitude it is in now, and how much of a turn it has done there --
// from ATTITUDE, which every vehicle sends.
//
// **Rates, not Euler yaw.** The obvious way to count turns is to watch `yaw`
// go round. It does not work: two of the six attitudes are nose-down and
// tail-down, which is pitch = ±90°, which is gimbal lock -- there yaw and
// roll describe the same rotation and `yaw` is not a reliable measure of
// anything. Turning about *earth vertical* is instead the body rate vector
// projected onto the body-frame direction of "down", which is well defined in
// every attitude including those two.

export type OrientationId = 'level' | 'upsideDown' | 'noseDown' | 'tailDown' | 'leftSide' | 'rightSide'

export interface Orientation {
  id: OrientationId
  label: string
  /** What "down" looks like in body frame when the vehicle is held this way. */
  down: readonly [number, number, number]
}

/**
 * The six, in the order they are worked through.
 *
 * Body frame is MAVLink's: X forward, Y right, Z down. So a level vehicle has
 * earth-down along +Z, one resting on its right side has it along +Y, and so
 * on. Level first because it is the one the vehicle is already in.
 */
export const ORIENTATIONS: readonly Orientation[] = [
  { id: 'level', label: 'Level', down: [0, 0, 1] },
  { id: 'leftSide', label: 'Left side down', down: [0, -1, 0] },
  { id: 'rightSide', label: 'Right side down', down: [0, 1, 0] },
  { id: 'noseDown', label: 'Nose down', down: [1, 0, 0] },
  // Labeled from the nose, like the one above it: "Nose up" and "Nose down"
  // are one pair of instructions, where "Tail down" made the reader work out
  // that it was the same aircraft the other way. The id is untouched -- it is
  // what the store's turn counts are keyed on.
  { id: 'tailDown', label: 'Nose up', down: [-1, 0, 0] },
  { id: 'upsideDown', label: 'Upside down', down: [0, 0, -1] },
]

/**
 * Earth's "down" expressed in body frame, from roll and pitch.
 *
 * The third column of the body-to-earth rotation, transposed -- and it needs
 * no yaw, which is the point: an attitude's identity does not depend on which
 * way the vehicle happens to be facing.
 */
export function downInBody(rollRad: number, pitchRad: number): [number, number, number] {
  return [
    -Math.sin(pitchRad),
    Math.sin(rollRad) * Math.cos(pitchRad),
    Math.cos(rollRad) * Math.cos(pitchRad),
  ]
}

/**
 * How close the vehicle has to be to count as being in an attitude.
 *
 * cos(35°): generous enough to hold a vehicle by hand without it flicking
 * between tiles, tight enough that the six cannot overlap -- they are 90°
 * apart, so anything under 45° is unambiguous.
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
 * Rotation rate about earth vertical, rad/s, sign ignored.
 *
 * The body rate vector projected onto body-frame down. Unsigned because a
 * turn is a turn: somebody spinning a vehicle on a bench does not keep to one
 * direction, and counting only one of them would stall the tile at half.
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
 * Turns wanted in each attitude before it counts as done.
 *
 * Deliberately short of the two the instruction asks for. The vehicle is the
 * judge of when it has enough samples, and it regularly declared itself
 * finished while a tile sat at nine-tenths -- so a threshold *at* the
 * instruction leaves the screen asking for a turn nobody needs to make. The
 * slack is small enough that it still takes a real second rotation.
 */
export const TURNS_REQUIRED = 1.75

/**
 * Ignore rates below this, in rad/s.
 *
 * A vehicle sitting still still reports small non-zero rates -- gyro noise,
 * and a hand resting on a bench -- and integrating those would fill a tile
 * on its own given long enough. About 3 deg/s, well under any deliberate
 * turn and well over the noise.
 */
export const RATE_FLOOR = 0.05
