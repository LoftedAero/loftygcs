// Pointing the camera, and knowing where it is pointed.
//
// ArduPilot has carried three generations of this and answers all of them,
// which is the whole difficulty. The old way is DO_MOUNT_CONFIGURE (204)
// plus DO_MOUNT_CONTROL (205), where angles ride in the command and the
// mode is set separately. The current way is the gimbal manager protocol:
// DO_GIMBAL_MANAGER_PITCHYAW (1000) with lock flags, which is what any
// gimbal shipped since 2022 expects and what a station should prefer.
//
// So which one gets sent depends on the firmware version, which the vehicle
// now tells us. Below 4.2 the gimbal manager does not exist and 1000 is
// answered with UNSUPPORTED; at or above it, 205 still works but is the
// deprecated path and does not carry the lock flags that decide whether the
// camera holds an earth heading or follows the airframe.
//
// Everything here is pure: it builds command parameter arrays and reads
// status messages, and never sends anything.

import type { FirmwareVersion } from './types'

/** MAV_MOUNT_MODE. */
export const MOUNT_MODES = [
  { value: 0, label: 'Retracted', hint: 'Stowed in its travel position.' },
  { value: 1, label: 'Neutral', hint: 'Held at its resting angles.' },
  { value: 2, label: 'MAVLink', hint: 'Pointed by this station.' },
  { value: 3, label: 'RC', hint: 'Pointed by the transmitter.' },
  { value: 4, label: 'GPS point', hint: 'Held on a location — the region of interest.' },
  { value: 6, label: 'Home', hint: 'Held on the launch point.' },
] as const

export function mountModeLabel(mode: number): string {
  return MOUNT_MODES.find((m) => m.value === mode)?.label ?? `Mode ${mode}`
}

/** MAV_CMD numbers used here, named so a reader need not look them up. */
export const CMD = {
  doMountConfigure: 204,
  doMountControl: 205,
  doDigicamControl: 203,
  imageStartCapture: 2000,
  imageStopCapture: 2001,
  videoStartCapture: 2500,
  videoStopCapture: 2501,
  setCameraZoom: 531,
  gimbalManagerPitchYaw: 1000,
} as const

/**
 * GIMBAL_MANAGER_FLAGS.
 *
 * The pair that matters day to day is the lock bits: with yaw locked the
 * camera holds an earth-frame heading while the aircraft turns under it,
 * and unlocked it follows the nose. Every other bit is a special case.
 */
export const GIMBAL_FLAGS = {
  retract: 1,
  neutral: 2,
  rollLock: 4,
  pitchLock: 8,
  yawLock: 16,
} as const

/** Whether this firmware speaks the gimbal manager protocol. */
export function hasGimbalManager(firmware: FirmwareVersion | null): boolean {
  if (!firmware) return false
  return firmware.major > 4 || (firmware.major === 4 && firmware.minor >= 2)
}

export interface GimbalCommand {
  command: number
  params: number[]
}

/**
 * Point the gimbal at an angle, in whichever dialect this vehicle speaks.
 *
 * Pitch is negative down in both, which is the one thing the two agree on.
 * `lockYaw` holds an earth heading; without it the camera follows the
 * airframe -- and on the old protocol there is no way to ask for either, so
 * it is simply absent rather than faked.
 */
export function pointGimbal(
  firmware: FirmwareVersion | null,
  pitchDeg: number,
  yawDeg: number,
  lockYaw = false,
): GimbalCommand {
  if (hasGimbalManager(firmware)) {
    const flags = GIMBAL_FLAGS.pitchLock | (lockYaw ? GIMBAL_FLAGS.yawLock : 0)
    // pitch, yaw, pitch rate, yaw rate, flags, unused, gimbal device id.
    // The rates are NaN in the spec to mean "use the angles"; ArduPilot
    // takes zero the same way and NaN does not survive the float encode on
    // every link, so zero it is.
    return { command: CMD.gimbalManagerPitchYaw, params: [pitchDeg, yawDeg, 0, 0, flags, 0, 0] }
  }
  // pitch, roll, yaw, unused, unused, unused, MAV_MOUNT_MODE (2 = MAVLink).
  return { command: CMD.doMountControl, params: [pitchDeg, 0, yawDeg, 0, 0, 0, 2] }
}

/** Put the mount in one of its modes (retract, RC targeting, and so on). */
export function setMountMode(mode: number): GimbalCommand {
  return { command: CMD.doMountConfigure, params: [mode, 0, 0, 0, 0, 0, 0] }
}

/**
 * Take a photo.
 *
 * IMAGE_START_CAPTURE is the modern command and what a camera behind the
 * camera protocol expects; ArduPilot's own servo and relay triggers answer
 * DO_DIGICAM_CONTROL instead. The caller sends the modern one and falls
 * back, rather than this file guessing from a parameter it cannot see.
 */
export function takePhoto(count = 1, intervalS = 0): GimbalCommand {
  // camera id (0 = all), interval, count (0 = forever), sequence.
  return { command: CMD.imageStartCapture, params: [0, intervalS, count, 0, 0, 0, 0] }
}

export function takePhotoLegacy(): GimbalCommand {
  // param5 = shot: ArduPilot's trigger, the one CAM_TRIGG_TYPE drives.
  return { command: CMD.doDigicamControl, params: [0, 0, 0, 0, 1, 0, 0] }
}

export function stopPhotos(): GimbalCommand {
  return { command: CMD.imageStopCapture, params: [0, 0, 0, 0, 0, 0, 0] }
}

export function recordVideo(start: boolean): GimbalCommand {
  return {
    command: start ? CMD.videoStartCapture : CMD.videoStopCapture,
    // stream id (0 = all), status frequency.
    params: [0, 0, 0, 0, 0, 0, 0],
  }
}

/**
 * Zoom.
 *
 * Type 1 is a continuous zoom whose value is -1, 0 or 1 -- out, stop, in --
 * and which keeps going until it is stopped. That is what a press-and-hold
 * button wants; the stepped type only exists on cameras that publish steps.
 */
export function zoom(direction: -1 | 0 | 1): GimbalCommand {
  return { command: CMD.setCameraZoom, params: [1, direction, 0, 0, 0, 0, 0] }
}

export interface GimbalAttitude {
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

const DEG = 180 / Math.PI

/**
 * Where the gimbal says it is pointed, from GIMBAL_DEVICE_ATTITUDE_STATUS.
 *
 * The message carries a quaternion, w first. The conversion is the standard
 * aerospace ZYX one, with the pitch term clamped: a gimbal looking straight
 * down puts the argument of asin at exactly 1, where floating point
 * routinely lands a hair outside and produces NaN.
 */
export function attitudeFromQuaternion(q: readonly number[]): GimbalAttitude | null {
  const [w, x, y, z] = q
  if (w === undefined || x === undefined || y === undefined || z === undefined) return null
  if (![w, x, y, z].every(Number.isFinite)) return null
  const sinPitch = Math.min(1, Math.max(-1, 2 * (w * y - z * x)))
  return {
    rollDeg: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG,
    pitchDeg: Math.asin(sinPitch) * DEG,
    yawDeg: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG,
  }
}

/**
 * The same, from the older MOUNT_STATUS.
 *
 * Its three fields are centidegrees and in the order pitch, roll, yaw --
 * which is not the order anything else uses, and is the reason this is a
 * function rather than three lines at the call site.
 */
export function attitudeFromMountStatus(
  pointingA: number,
  pointingB: number,
  pointingC: number,
): GimbalAttitude {
  return { pitchDeg: pointingA / 100, rollDeg: pointingB / 100, yawDeg: pointingC / 100 }
}
