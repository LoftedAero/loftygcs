// ArduPilot custom-mode numbers per vehicle type. Firmware-defined and
// stable; sourced from ArduPilot's mode definitions (Copter/Plane/Rover).
// The HEARTBEAT's MAV_TYPE picks which table applies.

const COPTER: Record<number, string> = {
  0: 'Stabilize',
  1: 'Acro',
  2: 'AltHold',
  3: 'Auto',
  4: 'Guided',
  5: 'Loiter',
  6: 'RTL',
  7: 'Circle',
  9: 'Land',
  11: 'Drift',
  13: 'Sport',
  14: 'Flip',
  15: 'AutoTune',
  16: 'PosHold',
  17: 'Brake',
  18: 'Throw',
  19: 'Avoid_ADSB',
  20: 'Guided_NoGPS',
  21: 'Smart_RTL',
  22: 'FlowHold',
  23: 'Follow',
  24: 'ZigZag',
  25: 'SystemID',
  26: 'Heli_Autorotate',
  27: 'Auto RTL',
  28: 'Turtle',
}

const PLANE: Record<number, string> = {
  0: 'Manual',
  1: 'Circle',
  2: 'Stabilize',
  3: 'Training',
  4: 'Acro',
  5: 'FBWA',
  6: 'FBWB',
  7: 'Cruise',
  8: 'AutoTune',
  10: 'Auto',
  11: 'RTL',
  12: 'Loiter',
  13: 'Takeoff',
  14: 'Avoid_ADSB',
  15: 'Guided',
  17: 'QStabilize',
  18: 'QHover',
  19: 'QLoiter',
  20: 'QLand',
  21: 'QRTL',
  22: 'QAutotune',
  23: 'QAcro',
  24: 'Thermal',
  25: 'Loiter to QLand',
  26: 'Autoland',
}

const ROVER: Record<number, string> = {
  0: 'Manual',
  1: 'Acro',
  3: 'Steering',
  4: 'Hold',
  5: 'Loiter',
  6: 'Follow',
  7: 'Simple',
  8: 'Dock',
  9: 'Circle',
  10: 'Auto',
  11: 'RTL',
  12: 'Smart_RTL',
  15: 'Guided',
}

// MAV_TYPE groupings. Copter covers all multirotors + heli; plane covers
// fixed wing + VTOL types (19-25 are quadplanes, which run ArduPlane).
const COPTER_TYPES = new Set([2, 3, 4, 13, 14, 15, 29])
const PLANE_TYPES = new Set([1, 16, 19, 20, 21, 22, 23, 24, 25])
const ROVER_TYPES = new Set([10, 11])

export type VehicleClass = 'copter' | 'plane' | 'rover' | 'other'

/** Broad family, for anything that needs to draw or reason about the airframe. */
export function vehicleClass(mavType: number): VehicleClass {
  if (COPTER_TYPES.has(mavType)) return 'copter'
  if (PLANE_TYPES.has(mavType)) return 'plane'
  if (ROVER_TYPES.has(mavType)) return 'rover'
  return 'other'
}

export function modeTable(mavType: number): Record<number, string> {
  if (COPTER_TYPES.has(mavType)) return COPTER
  if (PLANE_TYPES.has(mavType)) return PLANE
  if (ROVER_TYPES.has(mavType)) return ROVER
  return {}
}

/**
 * The custom-mode number a named mode has on this vehicle, or undefined.
 *
 * Needed because the numbers are not shared: Auto is 3 on Copter and 10 on
 * Plane, RTL is 6 and 11. A dedicated "RTL" button that hardcoded a number
 * would fly the wrong mode on half the vehicles this app supports.
 */
export function modeNumberByName(mavType: number, name: string): number | undefined {
  const wanted = name.toLowerCase()
  for (const [num, label] of Object.entries(modeTable(mavType))) {
    if (label.toLowerCase() === wanted) return Number(num)
  }
  return undefined
}

export function modeName(mavType: number, customMode: number): string {
  return modeTable(mavType)[customMode] ?? `Mode ${customMode}`
}

export function vehicleTypeName(mavType: number): string {
  if (COPTER_TYPES.has(mavType)) return 'Copter'
  if (PLANE_TYPES.has(mavType)) return 'Plane'
  if (ROVER_TYPES.has(mavType)) return 'Rover'
  if (mavType === 12) return 'Sub'
  if (mavType === 6) return 'GCS'
  return `Type ${mavType}`
}
