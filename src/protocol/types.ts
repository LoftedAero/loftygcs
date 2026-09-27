import type { AdsbTarget } from './adsb'
// Shared protocol types. Everything crossing the worker boundary must be
// structured-cloneable: plain objects and numbers, never class instances.

export interface MavFrame {
  version: 1 | 2
  seq: number
  sysid: number
  compid: number
  msgid: number
  /** Payload as received (MAVLink v2 truncates trailing zeros). */
  payload: Uint8Array
  signed: boolean
}

export type FieldValue = number | bigint | string | number[]

/**
 * One message type from one sender, as the inspector sees it.
 *
 * Keyed by (sysid, compid, msgid): a gimbal's ATTITUDE and the autopilot's
 * are different streams, and seeing the GCS's own traffic echoed back is how
 * a UDP loop is diagnosed.
 */
export interface InspectorRow {
  sysid: number
  compid: number
  msgid: number
  msgName: string
  /** Messages received since the link opened. */
  count: number
  /** Arrival rate, smoothed. */
  hz: number
  /** The most recent message's decoded fields. */
  fields: Record<string, FieldValue>
}

export interface DecodedMessage {
  msgid: number
  msgName: string
  sysid: number
  compid: number
  seq: number
  fields: Record<string, FieldValue>
}

/** What the engine tells the outside world. */
export type ProtocolEvent =
  | {
      t: 'heartbeat'
      sysid: number
      compid: number
      vehicleType: number
      autopilot: number
      baseMode: number
      customMode: number
      systemStatus: number
    }
  | { t: 'telemetry'; batch: TelemetryDelta[] }
  /**
   * Every numeric field the vehicle has sent, by `MESSAGE.field`, sampled at
   * a fixed rate for the status list and plots (`telemetry` is the curated
   * set the instruments read). Every value is resent each tick so samples
   * are evenly spaced.
   */
  | { t: 'fields'; at: number; values: Record<string, number> }
  | { t: 'statustext'; severity: number; text: string }
  /**
   * Snapshot of all ADS-B traffic currently heard, sent at a fixed low rate.
   * Busy airspace produces a report per aircraft per second, too many to
   * forward individually.
   */
  | { t: 'traffic'; targets: AdsbTarget[] }
  | { t: 'inspector'; rows: InspectorRow[] }
  | { t: 'commandAck'; command: number; result: number }
  | { t: 'linkStats'; stats: LinkStats }
  | { t: 'paramProgress'; got: number; total: number; source: 'ftp' | 'stream' }
  /** A file coming off the vehicle over MAVFTP, usually a log. */
  | { t: 'fileProgress'; path: string; got: number; total: number }
  | { t: 'missionProgress'; got: number; total: number; dir: 'read' | 'write' }
  | {
      t: 'magCalProgress'
      compassId: number
      calStatus: number
      pct: number
      completionMask: number[]
      /** Body-frame direction the vehicle is pointing, for the sphere. */
      direction: [number, number, number]
    }
  | { t: 'magCalReport'; compassId: number; calStatus: number; fitness: number; autosaved: number }
  /**
   * The side the accelerometer calibration is waiting for.
   *
   * ArduPilot repeats this request every second as a COMMAND_LONG
   * (`send_accelcal_vehicle_position`), while the "Place vehicle on its LEFT
   * side" text is printed only once. Following the command lets the wizard
   * rejoin a calibration already in progress, which MAVLink cannot cancel.
   */
  | { t: 'accelCalPosition'; position: number }
  /**
   * What the vehicle answered about itself: firmware version and the
   * capability bits. Sent once per connection, after the first heartbeat.
   */
  | {
      t: 'version'
      firmware: FirmwareVersion
      /** MAV_PROTOCOL_CAPABILITY bits, as far as they fit a number. */
      capabilities: number
      /** Board type, from the vendor/product ids the vehicle reports. */
      vendorId: number
      productId: number
      /**
       * ArduPilot's `APJ_BOARD_ID`, which the firmware manifest keys builds
       * by. Carried in AUTOPILOT_VERSION's `board_version` shifted up 16 bits.
       * Zero when the vehicle does not say (SITL does not).
       */
      boardId: number
    }

/** ArduPilot's own version, decoded from AUTOPILOT_VERSION. */
export interface FirmwareVersion {
  major: number
  minor: number
  patch: number
  /** FIRMWARE_VERSION_TYPE: 0 dev, 64 alpha, 128 beta, 192 rc, 255 official. */
  type: number
}

export type TelemetryDelta =
  | {
      k: 'attitude'
      rollRad: number
      pitchRad: number
      yawRad: number
      /** Body angular rates, rad/s, from the same ATTITUDE message. */
      rollRateRad: number
      pitchRateRad: number
      yawRateRad: number
    }
  /** Where the camera mount says it is pointed, in degrees. */
  | { k: 'gimbal'; rollDeg: number; pitchDeg: number; yawDeg: number }
  | {
      k: 'position'
      latDeg: number
      lonDeg: number
      altMslM: number
      relAltM: number
      headingDeg: number
    }
  | {
      k: 'hud'
      airspeedMs: number
      groundspeedMs: number
      headingDeg: number
      throttlePct: number
      altM: number
      climbMs: number
    }
  | { k: 'battery'; voltageV: number; currentA: number; remainingPct: number }
  /**
   * One battery monitor's reading, from BATTERY_STATUS. `id` is the monitor
   * instance (0 is BATT_, 1 is BATT2_); SYS_STATUS carries only the primary.
   * Voltage is null when not measured; current and remaining keep the wire's
   * -1 for that.
   */
  | {
      k: 'batteryStatus'
      id: number
      voltageV: number | null
      currentA: number
      remainingPct: number
    }
  | { k: 'gps'; fixType: number; satellites: number; hdop: number }
  | { k: 'rc'; channels: number[]; rssi: number }
  /**
   * What sixteen outputs are actually driving, from one SERVO_OUTPUT_RAW.
   *
   * `port` 0 is SERVO1-16 and 1 is SERVO17-32. ArduPilot sends 0 for an
   * output with nothing on it.
   */
  | { k: 'servoOutputs'; port: number; valuesUs: number[] }
  | { k: 'sensors'; present: number; enabled: number; health: number }
  /**
   * Where the vehicle is in its mission: MISSION_CURRENT gives the item,
   * NAV_CONTROLLER_OUTPUT the distance. A field is null until its message
   * arrives.
   */
  | {
      k: 'missionProgress'
      /** Sequence number of the item being flown, 0 being home. */
      seq: number | null
      /** Straight-line distance to that item, in meters. */
      wpDistM: number | null
      /** Meters the vehicle is above (positive) or below its target. */
      altErrorM: number | null
    }

export interface LinkStats {
  /** Packets parsed OK since the last report. */
  rxCount: number
  /** Bytes discarded hunting for a frame boundary since the last report. */
  droppedBytes: number
  /** Frames whose CRC failed or whose msgid is unknown. */
  badFrames: number
  /** ms since the last vehicle HEARTBEAT, or -1 before the first one. */
  heartbeatAgeMs: number
}

export interface ParamRecord {
  name: string
  value: number
  /** MAV_PARAM_TYPE as reported by the vehicle. */
  mavType: number
}

/**
 * One mission item in wire terms: x and y are latitude and longitude in
 * degrees * 1e7 (MISSION_ITEM_INT; floats lose meters of precision). Sequence
 * 0 is home by ArduPilot convention and is replaced with the real home at
 * arming, so a plan's item 0 is only the planned home.
 */
export interface MissionItem {
  seq: number
  /** MAV_FRAME: 0 abs MSL, 3 relative to home, 10 terrain-relative. */
  frame: number
  /** MAV_CMD. */
  command: number
  current: number
  autocontinue: number
  param1: number
  param2: number
  param3: number
  param4: number
  x: number
  y: number
  z: number
}

export interface ParamDownloadResult {
  source: 'ftp' | 'stream'
  params: ParamRecord[]
}

/** Request/response operations on the protocol worker. */
export type EngineRequest =
  | { op: 'downloadParams' }
  | { op: 'setParam'; name: string; value: number; mavType: number }
  | { op: 'command'; command: number; params: number[]; timeoutMs?: number }
  | { op: 'downloadMission'; missionType: number }
  | { op: 'uploadMission'; items: MissionItem[]; missionType: number }
  | { op: 'clearMission'; missionType: number }
  | { op: 'listFiles'; path: string }
  | { op: 'downloadFile'; path: string }
  | { op: 'cancelDownload' }
  | { op: 'uploadFile'; path: string; bytes: Uint8Array }
  | { op: 'removeFile'; path: string }
  | { op: 'createDirectory'; path: string }
  | { op: 'removeDirectory'; path: string }
  | { op: 'renameFile'; from: string; to: string }

/** Messages into the protocol worker. */
export type EngineCommand =
  | { t: 'rx'; bytes: Uint8Array }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'send'; msgName: string; fields: Record<string, FieldValue> }
  | { t: 'inspect'; on: boolean }
  | ({ t: 'req'; id: number } & EngineRequest)

/** Messages out of the protocol worker. */
export type EngineOutput =
  | { t: 'tx'; bytes: Uint8Array }
  | { t: 'evt'; evt: ProtocolEvent }
  | { t: 'res'; id: number; ok: true; data: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
