// Flight commands: thin, explicit wrappers so every UI control maps to one
// documented MAVLink action and returns the vehicle's verdict.
import { connectionService } from './connection'
import { useVehicleStore } from '../stores/vehicle-store'

const MAV_CMD_DO_SET_MODE = 176
const MAV_CMD_COMPONENT_ARM_DISARM = 400
const MAV_CMD_NAV_TAKEOFF = 22
const MAV_CMD_DO_SET_HOME = 179
const MAV_CMD_DO_CHANGE_SPEED = 178
const MAV_CMD_DO_SET_ROI_LOCATION = 195
const MAV_CMD_DO_DIGICAM_CONTROL = 203
const MAV_CMD_DO_SET_MISSION_CURRENT = 224
const MAV_CMD_PREFLIGHT_CALIBRATION = 241
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246
const MAV_CMD_SCRIPTING = 42701
// Magic value ArduPilot requires in param2 to force arm/disarm past checks.
const FORCE_MAGIC = 21196

export function setMode(customMode: number): Promise<number> {
  // param1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, param2 = the mode number.
  return connectionService.runCommand(MAV_CMD_DO_SET_MODE, [1, customMode, 0, 0, 0, 0, 0])
}

export function arm(force = false): Promise<number> {
  return connectionService.runCommand(
    MAV_CMD_COMPONENT_ARM_DISARM,
    [1, force ? FORCE_MAGIC : 0, 0, 0, 0, 0, 0],
    5000,
  )
}

export function disarm(force = false): Promise<number> {
  return connectionService.runCommand(
    MAV_CMD_COMPONENT_ARM_DISARM,
    [0, force ? FORCE_MAGIC : 0, 0, 0, 0, 0, 0],
    5000,
  )
}

export function takeoff(altitudeM: number): Promise<number> {
  return connectionService.runCommand(MAV_CMD_NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, altitudeM], 5000)
}

/** Point the camera (or the nose, on a vehicle without a gimbal) at a spot. */
export function setRoi(latDeg: number, lonDeg: number, altRelM = 0): Promise<number> {
  return connectionService.runCommand(
    MAV_CMD_DO_SET_ROI_LOCATION,
    [0, 0, 0, 0, latDeg, lonDeg, altRelM],
    5000,
  )
}

/** Clear a region of interest, returning the camera to its default aim. */
export function clearRoi(): Promise<number> {
  // Latitude and longitude of zero is ArduPilot's "no ROI" sentinel.
  return connectionService.runCommand(MAV_CMD_DO_SET_ROI_LOCATION, [0, 0, 0, 0, 0, 0, 0], 5000)
}

/**
 * Move home to a point on the map.
 *
 * param1 = 0 means "use the location I am giving you" rather than the
 * vehicle's present position. Altitude is left at zero: ArduPilot resolves it
 * from terrain or the EKF origin, and a number guessed from a map click would
 * be worse than no number at all.
 */
export function setHome(latDeg: number, lonDeg: number): Promise<number> {
  return connectionService.runCommand(
    MAV_CMD_DO_SET_HOME,
    [0, 0, 0, 0, latDeg, lonDeg, 0],
    5000,
  )
}

/**
 * Change the target speed.
 *
 * param1 picks which speed: 0 airspeed, 1 groundspeed. param3 is a throttle
 * percentage, and -1 leaves it alone -- passing 0 there would command idle.
 */
export function changeSpeed(speedMs: number, groundspeed = true): Promise<number> {
  return connectionService.runCommand(
    MAV_CMD_DO_CHANGE_SPEED,
    [groundspeed ? 1 : 0, speedMs, -1, 0, 0, 0, 0],
    5000,
  )
}

/** Jump the running mission to a particular item. */
export function setCurrentMissionItem(seq: number): Promise<number> {
  return connectionService.runCommand(MAV_CMD_DO_SET_MISSION_CURRENT, [seq, 0, 0, 0, 0, 0, 0], 5000)
}

/** Fire the camera shutter now. */
export function triggerCamera(): Promise<number> {
  // param5 = 1 is "shoot", the rest of DIGICAM_CONTROL's fields are unused.
  return connectionService.runCommand(
    MAV_CMD_DO_DIGICAM_CONTROL,
    [0, 0, 0, 0, 1, 0, 0],
    5000,
  )
}

/** The preflight calibration ArduPilot runs on the ground (barometer etc.). */
export function preflightCalibration(): Promise<number> {
  // param3 = 1 is the ground-pressure/airspeed calibration; the gyro and
  // accel entries are deliberately left off, since those have their own
  // guided flows on the Sensors tab.
  return connectionService.runCommand(
    MAV_CMD_PREFLIGHT_CALIBRATION,
    [0, 0, 1, 0, 0, 0, 0],
    10000,
  )
}

/** Stop and restart onboard Lua scripting. */
export function restartScripting(): Promise<number> {
  // SCRIPTING_CMD_STOP_AND_SCRIPTING_RESTART.
  return connectionService.runCommand(MAV_CMD_SCRIPTING, [2, 0, 0, 0, 0, 0, 0], 5000)
}

/** Reboot the autopilot. The link drops and has to be reconnected. */
export function rebootAutopilot(): Promise<number> {
  // param1 = 1 reboots the autopilot; anything higher shuts it down instead.
  return connectionService.runCommand(
    MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
    [1, 0, 0, 0, 0, 0, 0],
    5000,
  )
}

/** Guided "fly here": position-only target at the vehicle's current relative altitude (or the given one). */
export function gotoGuided(latDeg: number, lonDeg: number, altRelM?: number) {
  const v = useVehicleStore.getState()
  const alt = altRelM ?? Math.max(v.relAltM, 5)
  // Position-only typemask: ignore velocity(0x038)+accel(0x1C0)+yaw(0x400)+yawrate(0x800).
  connectionService.sendMessage('SET_POSITION_TARGET_GLOBAL_INT', {
    timeBootMs: 0,
    targetSystem: v.sysid || 1,
    targetComponent: 1,
    coordinateFrame: 6, // MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
    typeMask: 0x0df8,
    latInt: Math.round(latDeg * 1e7),
    lonInt: Math.round(lonDeg * 1e7),
    alt,
    vx: 0,
    vy: 0,
    vz: 0,
    afx: 0,
    afy: 0,
    afz: 0,
    yaw: 0,
    yawRate: 0,
  })
}

/**
 * Change the guided altitude, holding position.
 *
 * Sent as a position target at the vehicle's present latitude and longitude
 * rather than as a command, so it goes through exactly the path a "fly here"
 * does and cannot disagree with it.
 */
export function setGuidedAltitude(altRelM: number) {
  const v = useVehicleStore.getState()
  if (v.latDeg === 0 && v.lonDeg === 0) return
  gotoGuided(v.latDeg, v.lonDeg, altRelM)
}
