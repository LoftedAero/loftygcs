// Camera and gimbal commands, and decoding where the gimbal points. Pure:
// builds command parameters and reads status messages, never sends.
//
// ArduPilot answers several generations of mount commands. The old path is
// DO_MOUNT_CONFIGURE (204) plus DO_MOUNT_CONTROL (205); the current one is
// the gimbal manager's DO_GIMBAL_MANAGER_PITCHYAW (1000), which carries the
// lock flags. Below 4.2, 1000 is answered UNSUPPORTED, so the choice goes by
// firmware version.

import type { FirmwareVersion } from './types'

/** MAV_MOUNT_MODE. */
export const MOUNT_MODES = [
  { value: 0, label: 'Retracted' },
  { value: 1, label: 'Neutral' },
  { value: 2, label: 'MAVLink' },
  { value: 3, label: 'RC' },
  { value: 4, label: 'GPS point' },
  { value: 6, label: 'Home' },
] as const

export function mountModeLabel(mode: number): string {
  return MOUNT_MODES.find((m) => m.value === mode)?.label ?? `Mode ${mode}`
}

/** MAV_CMD numbers used here. */
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
 * GIMBAL_MANAGER_FLAGS. With yaw locked the camera holds an earth-frame
 * heading; unlocked it follows the nose.
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
 * Points the gimbal, using whichever protocol this firmware supports. Pitch
 * is negative down in both. `lockYaw` has no equivalent on the old protocol
 * and is ignored there.
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
    // The spec uses NaN rates to mean "use the angles"; ArduPilot treats zero
    // the same way, and NaN does not survive every link's float encoding.
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
 * IMAGE_START_CAPTURE, for cameras using the camera protocol. ArduPilot's
 * servo and relay triggers answer DO_DIGICAM_CONTROL instead
 * (`takePhotoLegacy`); the caller falls back on UNSUPPORTED.
 */
export function takePhoto(count = 1, intervalS = 0): GimbalCommand {
  // camera id (0 = all), interval, count (0 = forever), sequence.
  return { command: CMD.imageStartCapture, params: [0, intervalS, count, 0, 0, 0, 0] }
}

export function takePhotoLegacy(): GimbalCommand {
  // param5 = shot, which fires the trigger CAM_TRIGG_TYPE configures.
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
 * Continuous zoom (type 1): -1 out, 0 stop, 1 in. It runs until stopped,
 * which suits a press-and-hold button.
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
 * Gimbal attitude from GIMBAL_DEVICE_ATTITUDE_STATUS's quaternion (w first),
 * using the standard ZYX conversion. The asin argument is clamped because a
 * gimbal looking straight down lands just outside [-1, 1] and yields NaN.
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

/** Gimbal attitude from the older MOUNT_STATUS: centidegrees, ordered pitch, roll, yaw. */
export function attitudeFromMountStatus(
  pointingA: number,
  pointingB: number,
  pointingC: number,
): GimbalAttitude {
  return { pitchDeg: pointingA / 100, rollDeg: pointingB / 100, yawDeg: pointingC / 100 }
}
