import { connectionService } from './connection'
import {
  CMD,
  pointGimbal,
  recordVideo,
  setMountMode,
  stopPhotos,
  takePhoto,
  takePhotoLegacy,
  zoom,
  type GimbalCommand,
} from '../protocol/gimbal'
import { useVehicleStore } from '../stores/vehicle-store'

// Working the camera and the mount.
//
// Each of these is one ack-verified command, so the caller learns whether
// the vehicle actually did it. That matters more here than elsewhere:
// ArduPilot answers every one of these commands even with no camera or
// mount configured, and the answer is the only difference between "the
// photo was taken" and "MNT1_TYPE is still zero".

/** MAV_RESULT_ACCEPTED. */
const ACCEPTED = 0
/** MAV_RESULT_UNSUPPORTED, which is a vehicle saying it has never heard of this. */
const UNSUPPORTED = 3

export class CommandRefused extends Error {
  constructor(readonly result: number) {
    super(describeResult(result))
  }
}

function describeResult(result: number): string {
  switch (result) {
    case 1:
      return 'The vehicle is busy'
    case 2:
      return 'The vehicle rejected it — check the mount or camera is configured'
    case 3:
      return 'This firmware does not support that command'
    case 4:
      return 'The vehicle tried and failed — is a camera or mount set up?'
    default:
      return `The vehicle answered ${result}`
  }
}

async function run(cmd: GimbalCommand): Promise<void> {
  const result = await connectionService.runCommand(cmd.command, cmd.params)
  if (result !== ACCEPTED) throw new CommandRefused(result)
}

/** Point the mount, in whichever protocol this firmware speaks. */
export function point(pitchDeg: number, yawDeg: number, lockYaw = false): Promise<void> {
  return run(pointGimbal(useVehicleStore.getState().firmware, pitchDeg, yawDeg, lockYaw))
}

export function mountMode(mode: number): Promise<void> {
  return run(setMountMode(mode))
}

/**
 * Take a photo, falling back to ArduPilot's own trigger.
 *
 * IMAGE_START_CAPTURE is the camera protocol's command and is what a
 * gimbal-mounted camera answers. A servo or relay shutter wired straight to
 * the autopilot predates that protocol and only answers DO_DIGICAM_CONTROL,
 * so an UNSUPPORTED is a reason to try the older one rather than to report
 * failure -- the same fallback shape as the parameter and FTP paths.
 */
export async function photo(): Promise<void> {
  try {
    await run(takePhoto())
  } catch (err) {
    if (err instanceof CommandRefused && err.result === UNSUPPORTED) {
      await run(takePhotoLegacy())
      return
    }
    throw err
  }
}

export function photoSequence(intervalS: number): Promise<void> {
  return run(takePhoto(0, intervalS))
}

export function stopSequence(): Promise<void> {
  return run(stopPhotos())
}

export function record(start: boolean): Promise<void> {
  return run(recordVideo(start))
}

export function zoomCamera(direction: -1 | 0 | 1): Promise<void> {
  return run(zoom(direction))
}

export { CMD }
