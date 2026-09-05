import { describe, expect, it } from 'vitest'
import {
  attitudeFromMountStatus,
  attitudeFromQuaternion,
  CMD,
  GIMBAL_FLAGS,
  hasGimbalManager,
  mountModeLabel,
  pointGimbal,
  recordVideo,
  setMountMode,
  takePhoto,
  zoom,
} from './gimbal'
import type { FirmwareVersion } from './types'

const fw = (major: number, minor: number, patch = 0): FirmwareVersion => ({
  major,
  minor,
  patch,
  type: 255,
})

describe('which protocol this firmware speaks', () => {
  it('uses the gimbal manager from 4.2 on', () => {
    // The gimbal manager arrived in 4.2. Below it the command exists in the
    // spec and is answered UNSUPPORTED, which looks to a user like a broken
    // gimbal rather than an old one.
    expect(hasGimbalManager(fw(4, 2))).toBe(true)
    expect(hasGimbalManager(fw(4, 6, 3))).toBe(true)
    expect(hasGimbalManager(fw(5, 0))).toBe(true)
    expect(hasGimbalManager(fw(4, 1, 6))).toBe(false)
    expect(hasGimbalManager(fw(3, 6))).toBe(false)
  })

  it('takes the old path when the vehicle never said', () => {
    // A vehicle that did not answer AUTOPILOT_VERSION gets the command that
    // every ArduPilot has always understood.
    expect(hasGimbalManager(null)).toBe(false)
    expect(pointGimbal(null, -45, 0).command).toBe(CMD.doMountControl)
  })
})

describe('pointing the gimbal', () => {
  it('sends pitch and yaw where the modern command expects them', () => {
    const { command, params } = pointGimbal(fw(4, 5), -45, 90)
    expect(command).toBe(CMD.gimbalManagerPitchYaw)
    expect(params[0]).toBe(-45)
    expect(params[1]).toBe(90)
  })

  it('sends them where the old command expects them, which is not the same place', () => {
    // DO_MOUNT_CONTROL is pitch, roll, yaw -- yaw is param3, not param2.
    // Putting yaw in param2 rolls the camera instead of turning it.
    const { command, params } = pointGimbal(fw(4, 1), -45, 90)
    expect(command).toBe(CMD.doMountControl)
    expect(params[0]).toBe(-45)
    expect(params[1]).toBe(0)
    expect(params[2]).toBe(90)
    // And the mode rides in param7: MAV_MOUNT_MODE_MAVLINK_TARGETING.
    expect(params[6]).toBe(2)
  })

  it('locks yaw only when asked', () => {
    const locked = pointGimbal(fw(4, 5), 0, 0, true).params[4]!
    const free = pointGimbal(fw(4, 5), 0, 0, false).params[4]!
    expect(locked & GIMBAL_FLAGS.yawLock).toBeTruthy()
    expect(free & GIMBAL_FLAGS.yawLock).toBeFalsy()
    // Pitch is always locked: a camera that pitches with the airframe is
    // not pointing anywhere anyone asked for.
    expect(free & GIMBAL_FLAGS.pitchLock).toBeTruthy()
  })

  it('sends no rates, because the angles are the request', () => {
    const { params } = pointGimbal(fw(4, 5), -30, 10)
    expect(params[2]).toBe(0)
    expect(params[3]).toBe(0)
  })

  it('sets a mount mode with the configure command', () => {
    expect(setMountMode(3)).toEqual({ command: CMD.doMountConfigure, params: [3, 0, 0, 0, 0, 0, 0] })
  })

  it('names the modes', () => {
    expect(mountModeLabel(3)).toBe('RC')
    expect(mountModeLabel(0)).toBe('Retracted')
    expect(mountModeLabel(99)).toBe('Mode 99')
  })
})

describe('the camera', () => {
  it('takes one photo by default', () => {
    const { command, params } = takePhoto()
    expect(command).toBe(CMD.imageStartCapture)
    expect(params[2]).toBe(1)
  })

  it('can be asked for a timed sequence', () => {
    const { params } = takePhoto(0, 2)
    // Count 0 means keep going; interval is seconds.
    expect(params[1]).toBe(2)
    expect(params[2]).toBe(0)
  })

  it('starts and stops recording with different commands, not a flag', () => {
    expect(recordVideo(true).command).toBe(CMD.videoStartCapture)
    expect(recordVideo(false).command).toBe(CMD.videoStopCapture)
  })

  it('zooms continuously, which is what a held button wants', () => {
    expect(zoom(1).params[0]).toBe(1)
    expect(zoom(1).params[1]).toBe(1)
    expect(zoom(-1).params[1]).toBe(-1)
    // Zero is the stop, and it is a value rather than another command.
    expect(zoom(0).params[1]).toBe(0)
  })
})

describe('reading where it is pointed', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4)

  it('reads the identity quaternion as level and forward', () => {
    const at = attitudeFromQuaternion([1, 0, 0, 0])!
    near(at.rollDeg, 0)
    near(at.pitchDeg, 0)
    near(at.yawDeg, 0)
  })

  it('reads a 90 degree yaw', () => {
    const h = Math.SQRT1_2
    const at = attitudeFromQuaternion([h, 0, 0, h])!
    near(at.yawDeg, 90)
    near(at.pitchDeg, 0)
  })

  it('reads a 45 degree nose-down pitch', () => {
    const a = -22.5 * (Math.PI / 180)
    const at = attitudeFromQuaternion([Math.cos(a), 0, Math.sin(a), 0])!
    near(at.pitchDeg, -45)
  })

  it('survives straight down, where the naive formula returns NaN', () => {
    // A gimbal looking at the ground puts asin's argument at exactly 1, and
    // floating point routinely lands a hair outside it.
    const a = -45 * (Math.PI / 180)
    const at = attitudeFromQuaternion([Math.cos(a), 0, Math.sin(a), 0])!
    expect(Number.isFinite(at.pitchDeg)).toBe(true)
    near(at.pitchDeg, -90)
    // And the other pole, where the sign of y flips.
    expect(attitudeFromQuaternion([0.7071068, 0, 0.7071068, 0])!.pitchDeg).toBeCloseTo(90, 3)
  })

  it('refuses a quaternion that is not one', () => {
    expect(attitudeFromQuaternion([1, 0, 0])).toBeNull()
    expect(attitudeFromQuaternion([NaN, 0, 0, 0])).toBeNull()
  })

  it('reads the old message, whose fields are in an unusual order', () => {
    // pointing_a is pitch, pointing_b is roll, pointing_c is yaw, all in
    // centidegrees. Reading them in the roll-pitch-yaw order everything
    // else uses swaps two axes silently.
    expect(attitudeFromMountStatus(-4500, 100, 9000)).toEqual({
      pitchDeg: -45,
      rollDeg: 1,
      yawDeg: 90,
    })
  })
})
