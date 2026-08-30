// Flight commands: thin, explicit wrappers so every UI control maps to one
// documented MAVLink action and returns the vehicle's verdict.
import { connectionService } from './connection'
import { useVehicleStore } from '../stores/vehicle-store'

const MAV_CMD_DO_SET_MODE = 176
const MAV_CMD_COMPONENT_ARM_DISARM = 400
const MAV_CMD_NAV_TAKEOFF = 22
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
