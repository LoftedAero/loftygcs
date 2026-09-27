// Flight commands: thin, explicit wrappers so every UI control maps to one
// documented MAVLink action and returns the vehicle's verdict.
import { connectionService } from './connection'
import { useVehicleStore } from '../stores/vehicle-store'
import { useParamStore } from '../stores/param-store'
import { modeNumberByName, vehicleClass } from '../protocol/modes'

/** MAV_RESULT_UNSUPPORTED: this vehicle has no handler for the request. */
const MAV_RESULT_UNSUPPORTED = 3

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

/**
 * How long a takeoff keeps trying to reach Guided by default. The vehicle
 * refuses Guided with "requires position" until its EKF has a good fix,
 * which can lag arming by several seconds.
 */
const GUIDED_WAIT_MS = 20000

export function setMode(customMode: number): Promise<number> {
  // param1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, param2 = the mode number.
  return connectionService.runCommand(MAV_CMD_DO_SET_MODE, [1, customMode, 0, 0, 0, 0, 0])
}

/**
 * Wait for the heartbeat to actually report a mode.
 *
 * ArduPilot acks DO_SET_MODE before committing to the change, so a mode it
 * then refuses ("Mode change to Guided failed: requires position") still
 * reads ACCEPTED. Only the heartbeat says whether the mode was taken.
 */
export async function modeReached(customMode: number, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (useVehicleStore.getState().customMode === customMode) return true
    await new Promise((r) => setTimeout(r, 150))
  }
  return useVehicleStore.getState().customMode === customMode
}

/** Ask for a mode and report whether the vehicle really took it. */
export async function setModeConfirmed(customMode: number, timeoutMs?: number): Promise<number> {
  const result = await setMode(customMode)
  if (result !== 0) return result
  // MAV_RESULT_FAILED, which is what a mode the vehicle declined amounts to.
  return (await modeReached(customMode, timeoutMs)) ? 0 : 4
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

/**
 * Climb to an altitude.
 *
 * Copter only accepts NAV_TAKEOFF in Guided (or a running Auto mission), and
 * a freshly booted vehicle sits in Stabilize. So, like other ground
 * stations, this switches to Guided, confirms it from the heartbeat, then
 * commands the climb.
 *
 * Airframes differ, and the ack alone cannot tell them apart because a
 * quadplane accepts both routes:
 *
 *   copter      Guided + NAV_TAKEOFF   climbs to the altitude asked for
 *   quadplane   Guided + NAV_TAKEOFF   vertical takeoff
 *               mode TAKEOFF           also accepted, but flies a runway
 *                                      takeoff run
 *   fixed wing  NAV_TAKEOFF            FAILED, even armed and in Guided
 *               mode TAKEOFF           climbs away down the runway
 *
 * NAV_VTOL_TAKEOFF is UNSUPPORTED on both plane types (a mission item with
 * no runtime handler).
 *
 * The split needs `Q_ENABLE`, because MAV_TYPE cannot tell a quadplane from
 * a fixed wing: both report FIXED_WING(1).
 */
export type TakeoffStyle = 'guided' | 'mode' | 'unsupported'

/**
 * How this airframe leaves the ground.
 *
 * Exported so the button label and the command share one answer.
 *
 * `Q_ENABLE` absent means parameters have not arrived yet. Guessing
 * quadplane on a fixed wing just gets FAILED back, while guessing fixed wing
 * on a quadplane starts a runway run, so the unknown case takes Guided.
 */
export function takeoffStyle(vehicleType: number, qEnable: number | undefined): TakeoffStyle {
  const cls = vehicleClass(vehicleType)
  if (cls === 'copter') return 'guided'
  if (cls !== 'plane') return 'unsupported'
  return qEnable === undefined || qEnable > 0 ? 'guided' : 'mode'
}

export async function takeoff(altitudeM: number, guidedWaitMs = GUIDED_WAIT_MS): Promise<number> {
  const v = useVehicleStore.getState()
  const style = takeoffStyle(v.vehicleType, useParamStore.getState().entries.get('Q_ENABLE')?.value)

  if (style === 'unsupported') return MAV_RESULT_UNSUPPORTED
  if (style === 'mode') {
    // A fixed wing climbs to its own TKOFF_ALT; ours is not used.
    const takeoffMode = modeNumberByName(v.vehicleType, 'Takeoff')
    if (takeoffMode === undefined) return MAV_RESULT_UNSUPPORTED
    return setModeConfirmed(takeoffMode)
  }

  const guided = modeNumberByName(v.vehicleType, 'Guided')
  if (guided !== undefined && v.customMode !== guided) {
    // Retried: "requires position" is refused while the EKF is still
    // settling and usually clears within a couple of seconds.
    let result = 4
    const deadline = Date.now() + guidedWaitMs
    for (;;) {
      result = await setModeConfirmed(guided)
      if (result === 0 || Date.now() > deadline) break
      await new Promise((r) => setTimeout(r, 1500))
    }
    if (result !== 0) return result

    // Copter disarms itself after about ten seconds armed on the ground, and
    // reaching Guided can take that long. The vehicle was armed when Takeoff
    // was pressed, so re-arm.
    if (!useVehicleStore.getState().armed) {
      const rearmed = await arm()
      if (rearmed !== 0) return rearmed
      const until = Date.now() + 3000
      while (Date.now() < until && !useVehicleStore.getState().armed) {
        await new Promise((r) => setTimeout(r, 150))
      }
    }
  }
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
 * param1 = 0 means use the given location rather than the vehicle's current
 * position. Altitude is left at zero for ArduPilot to resolve from terrain or
 * the EKF origin.
 */
export function setHome(latDeg: number, lonDeg: number): Promise<number> {
  return connectionService.runCommand(MAV_CMD_DO_SET_HOME, [0, 0, 0, 0, latDeg, lonDeg, 0], 5000)
}

/**
 * Change the target speed.
 *
 * param1 picks which speed: 0 airspeed, 1 groundspeed. param3 is a throttle
 * percentage, and -1 leaves it alone; passing 0 there would command idle.
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
  return connectionService.runCommand(MAV_CMD_DO_DIGICAM_CONTROL, [0, 0, 0, 0, 1, 0, 0], 5000)
}

/** The preflight calibration ArduPilot runs on the ground (barometer etc.). */
export function preflightCalibration(): Promise<number> {
  // param3 = 1 is the ground-pressure/airspeed calibration. Gyro and accel
  // have their own flows on the Sensors tab.
  return connectionService.runCommand(MAV_CMD_PREFLIGHT_CALIBRATION, [0, 0, 1, 0, 0, 0, 0], 10000)
}

/** Stop and restart onboard Lua scripting. */
export function restartScripting(): Promise<number> {
  // SCRIPTING_CMD_STOP_AND_SCRIPTING_RESTART.
  return connectionService.runCommand(MAV_CMD_SCRIPTING, [2, 0, 0, 0, 0, 0, 0], 5000)
}

/** Reboot the autopilot. The link drops and has to be reconnected. */
export function rebootAutopilot(): Promise<number> {
  // Before sending: ArduPilot may obey without acking, so on USB the device
  // can be gone before this promise settles.
  connectionService.expectReboot()
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
 * Sent as a position target at the vehicle's current position, the same
 * path "fly here" uses.
 */
export function setGuidedAltitude(altRelM: number) {
  const v = useVehicleStore.getState()
  if (v.latDeg === 0 && v.lonDeg === 0) return
  gotoGuided(v.latDeg, v.lonDeg, altRelM)
}
