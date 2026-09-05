// Normalizes raw decoded messages into TelemetryDelta units the rest of the
// app can trust: degrees, meters, volts -- never the wire's centidegrees,
// millimeters, or centiamps. All unit conversion happens here and nowhere
// else.
import type { DecodedMessage, TelemetryDelta } from './types'

/** One message can carry several facts -- SYS_STATUS is both power and sensors. */
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
    case 'SYS_STATUS':
      return [
        {
          k: 'battery',
          voltageV: (f.voltageBattery as number) / 1000,
          // -1 means "not measured" on the wire; keep it as-is so the UI can
          // show a dash instead of a fictitious 0.01 A draw.
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
    case 'GPS_RAW_INT':
      return [
        {
          k: 'gps',
          fixType: f.fixType as number,
          satellites: f.satellitesVisible as number,
          // eph is centimetres of horizontal spread; HDOP is the familiar form.
          hdop: (f.eph as number) / 100,
        },
      ]
    case 'RC_CHANNELS': {
      const count = Math.min((f.chancount as number) || 16, 16)
      const channels: number[] = []
      for (let i = 1; i <= count; i++) channels.push((f[`chan${i}Raw`] as number) ?? 0)
      // 255 is MAVLink's "receiver does not report RSSI"; -1 keeps that
      // distinct from a genuine reading of zero, which means no signal.
      const raw = f.rssi as number | undefined
      const rssi = raw === undefined || raw === 255 ? -1 : raw
      return [{ k: 'rc', channels, rssi }]
    }
    default:
      return []
  }
}
