// SYS_STATUS carries three bitmasks over the same set of sensor bits:
// what the board has, what is switched on, and what is currently healthy.
// Comparing them is the difference between "no compass fitted" and "compass
// fitted and failing", which are very different things to tell a pilot.

export const SENSOR_BITS = {
  gyro: 1 << 0,
  accel: 1 << 1,
  mag: 1 << 2,
  baro: 1 << 3,
  airspeed: 1 << 4,
  gps: 1 << 5,
  opticalFlow: 1 << 6,
  rangefinder: 1 << 8,
  rcReceiver: 1 << 16,
  gyro2: 1 << 17,
  accel2: 1 << 18,
  mag2: 1 << 19,
  geofence: 1 << 20,
  ahrs: 1 << 21,
  terrain: 1 << 22,
  logging: 1 << 24,
  battery: 1 << 25,
  proximity: 1 << 26,
  prearm: 1 << 28,
} as const

export type SensorId = keyof typeof SENSOR_BITS

export type SensorState = 'healthy' | 'unhealthy' | 'disabled' | 'absent'

export interface SensorReading {
  id: SensorId
  label: string
  state: SensorState
}

/** Display order and names, chosen for what a pilot checks before flying. */
const SENSOR_LABELS: [SensorId, string][] = [
  ['gyro', 'Gyroscope'],
  ['accel', 'Accelerometer'],
  ['mag', 'Compass'],
  ['baro', 'Barometer'],
  ['gps', 'GPS'],
  ['airspeed', 'Airspeed'],
  ['rangefinder', 'Rangefinder'],
  ['opticalFlow', 'Optical flow'],
  ['rcReceiver', 'RC receiver'],
  ['battery', 'Battery monitor'],
  ['ahrs', 'AHRS'],
  ['logging', 'Logging'],
  ['geofence', 'Geofence'],
  // Bit 28 is deliberately absent: MAV_SYS_STATUS_PREARM_CHECK is not a
  // sensor, it is ArduPilot saying whether its prearm checks are passing.
  // Listed here it came out under "Unhealthy sensors", which tells a pilot
  // they have broken hardware when what they have is an unmet arming
  // condition -- and says it a second time, worse, because the same bit is
  // already the readiness state at the top of the Preflight pane
  // (`armReadiness`). The bit stays in SENSOR_BITS for that reader.
]

export function decodeSensors(present: number, enabled: number, health: number): SensorReading[] {
  const readings: SensorReading[] = []
  for (const [id, label] of SENSOR_LABELS) {
    const bit = SENSOR_BITS[id]
    // A sensor the board never reported is left out entirely rather than
    // listed as broken -- most airframes have no airspeed or rangefinder.
    if ((present & bit) === 0) continue
    let state: SensorState
    if ((enabled & bit) === 0) state = 'disabled'
    else if ((health & bit) === 0) state = 'unhealthy'
    else state = 'healthy'
    readings.push({ id, label, state })
  }
  return readings
}

/** Anything present and switched on but not reporting healthy. */
export function unhealthySensors(readings: SensorReading[]): SensorReading[] {
  return readings.filter((r) => r.state === 'unhealthy')
}
