// Normalizes decoded messages into TelemetryDelta units: degrees, meters and
// volts rather than the wire's centidegrees, millimeters and centiamps. All
// wire unit conversion happens here.
import { attitudeFromMountStatus, attitudeFromQuaternion } from './gimbal'
import type { DecodedMessage, TelemetryDelta } from './types'

/** SERVO_OUTPUT_RAW carries a fixed servo1Raw..servo16Raw, not a count field. */
const SERVO_OUTPUT_COUNT = 16
/**
 * Outputs a board can report: two messages of sixteen. ArduPilot builds with
 * 32 on any board with more than 1 MB of flash, and sends the upper half as a
 * second SERVO_OUTPUT_RAW with `port` 1.
 */
const SERVO_OUTPUT_PORTS = 2

/** One message can yield several deltas (SYS_STATUS is both power and sensors). */
export function messageToDeltas(msg: DecodedMessage): TelemetryDelta[] {
  const f = msg.fields
  switch (msg.msgName) {
    case 'ATTITUDE':
      return [
        {
          k: 'attitude',
          rollRad: f.roll as number,
          pitchRad: f.pitch as number,
          yawRad: f.yaw as number,
          // Compass calibration projects these onto earth vertical, which
          // still works nose-down where Euler yaw is degenerate.
          rollRateRad: f.rollspeed as number,
          pitchRateRad: f.pitchspeed as number,
          yawRateRad: f.yawspeed as number,
        },
      ]
    case 'GLOBAL_POSITION_INT':
      return [
        {
          k: 'position',
          latDeg: (f.lat as number) / 1e7,
          lonDeg: (f.lon as number) / 1e7,
          altMslM: (f.alt as number) / 1000,
          relAltM: (f.relativeAlt as number) / 1000,
          headingDeg: (f.hdg as number) / 100,
        },
      ]
    case 'VFR_HUD':
      return [
        {
          k: 'hud',
          airspeedMs: f.airspeed as number,
          groundspeedMs: f.groundspeed as number,
          headingDeg: f.heading as number,
          throttlePct: f.throttle as number,
          altM: f.alt as number,
          climbMs: f.climb as number,
        },
      ]
    // ArduPilot sends MISSION_CURRENT on every item change and repeats it;
    // NAV_CONTROLLER_OUTPUT streams while a navigation mode is flying. Each
    // fills in its own half and leaves the other alone.
    case 'MISSION_CURRENT':
      return [{ k: 'missionProgress', seq: f.seq as number, wpDistM: null, altErrorM: null }]
    case 'NAV_CONTROLLER_OUTPUT':
      return [
        {
          k: 'missionProgress',
          seq: null,
          wpDistM: f.wpDist as number,
          altErrorM: f.altError as number,
        },
      ]
    // Two generations of the same data: the modern message carries a
    // quaternion, the old one three centidegree fields in an unusual order.
    // A vehicle sends one or the other.
    case 'GIMBAL_DEVICE_ATTITUDE_STATUS': {
      const at = attitudeFromQuaternion((f.q as number[]) ?? [])
      return at ? [{ k: 'gimbal', ...at }] : []
    }
    case 'MOUNT_STATUS':
      return [
        {
          k: 'gimbal',
          ...attitudeFromMountStatus(
            f.pointingA as number,
            f.pointingB as number,
            f.pointingC as number,
          ),
        },
      ]
    case 'SYS_STATUS':
      return [
        {
          k: 'battery',
          voltageV: (f.voltageBattery as number) / 1000,
          // -1 means "not measured"; kept so the UI can show a dash.
          currentA: (f.currentBattery as number) < 0 ? -1 : (f.currentBattery as number) / 100,
          remainingPct: f.batteryRemaining as number,
        },
        {
          k: 'sensors',
          present: f.onboardControlSensorsPresent as number,
          enabled: f.onboardControlSensorsEnabled as number,
          health: f.onboardControlSensorsHealth as number,
        },
      ]
    case 'BATTERY_STATUS':
      return [
        {
          k: 'batteryStatus',
          id: f.id as number,
          voltageV: packVoltage(
            (f.voltages as number[] | undefined) ?? [],
            (f.voltagesExt as number[] | undefined) ?? [],
          ),
          currentA: (f.currentBattery as number) < 0 ? -1 : (f.currentBattery as number) / 100,
          remainingPct: f.batteryRemaining as number,
        },
      ]
    case 'GPS_RAW_INT':
      return [
        {
          k: 'gps',
          fixType: f.fixType as number,
          satellites: f.satellitesVisible as number,
          // eph is centimeters of horizontal spread; HDOP is the familiar form.
          hdop: (f.eph as number) / 100,
        },
      ]
    case 'RC_CHANNELS': {
      const count = Math.min((f.chancount as number) || 16, 16)
      const channels: number[] = []
      for (let i = 1; i <= count; i++) channels.push((f[`chan${i}Raw`] as number) ?? 0)
      // 255 is MAVLink's "RSSI not reported"; -1 keeps it distinct from a
      // real reading of zero.
      const raw = f.rssi as number | undefined
      const rssi = raw === undefined || raw === 255 ? -1 : raw
      return [{ k: 'rc', channels, rssi }]
    }
    case 'SERVO_OUTPUT_RAW': {
      // `port` says which sixteen these are. A 32-channel board sends port 1
      // (outputs 17-32) right after port 0 every cycle; ignoring the port
      // would overwrite outputs 1-16 with the upper half, usually zeros. SITL
      // builds with 16 channels and never sends port 1.
      const port = (f.port as number | undefined) ?? 0
      if (port >= SERVO_OUTPUT_PORTS) return []
      const valuesUs: number[] = []
      for (let i = 1; i <= SERVO_OUTPUT_COUNT; i++) {
        valuesUs.push((f[`servo${i}Raw`] as number | undefined) ?? 0)
      }
      return [{ k: 'servoOutputs', port, valuesUs }]
    }
    default:
      return []
  }
}

/**
 * A pack's total from BATTERY_STATUS's cell slots, in volts, or null.
 *
 * The slots are cells only when the monitor measures cells. Otherwise
 * ArduPilot writes the pack total into the first slot and carries anything
 * past 65,534 mV into the next, so the total is the sum of every used slot
 * either way. Unused is 65535 in `voltages` and 0 or 65535 in the extension.
 */
export function packVoltage(voltages: readonly number[], ext: readonly number[]): number | null {
  const UNUSED = 0xffff
  const used = [
    ...voltages.filter((mv) => mv !== UNUSED),
    ...ext.filter((mv) => mv !== 0 && mv !== UNUSED),
  ]
  return used.length ? used.reduce((a, b) => a + b, 0) / 1000 : null
}

/**
 * Place one SERVO_OUTPUT_RAW's sixteen values at its port's offset, keeping the
 * other port's. The result is always 32 long; index 0 is SERVO1.
 */
export function mergeServoOutputs(
  prev: readonly number[],
  port: number,
  valuesUs: readonly number[],
): number[] {
  const next = Array.from(
    { length: SERVO_OUTPUT_COUNT * SERVO_OUTPUT_PORTS },
    (_, i) => prev[i] ?? 0,
  )
  const base = port * SERVO_OUTPUT_COUNT
  valuesUs.forEach((v, i) => {
    next[base + i] = v
  })
  return next
}
