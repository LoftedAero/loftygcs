import type { AdsbTarget } from './adsb'
// Shared protocol types. Everything crossing the worker boundary must be
// structured-cloneable: plain objects and numbers, never class instances.

export interface MavFrame {
  version: 1 | 2
  seq: number
  sysid: number
  compid: number
  msgid: number
  /** Payload as received -- MAVLink v2 truncates trailing zeros. */
  payload: Uint8Array
  signed: boolean
}

export type FieldValue = number | bigint | string | number[]

/**
 * One message type from one sender, as the inspector sees it.
 *
 * Keyed by (sysid, compid, msgid) rather than msgid alone: a gimbal's
 * ATTITUDE and the autopilot's ATTITUDE are different conversations, and
 * seeing your own GCS traffic echoed back is exactly the diagnostic a UDP
 * loop hides when senders are collapsed together.
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
   * a fixed rate. This is the generic path that feeds the status list and the
   * plots -- as opposed to `telemetry`, which is the curated set the flight
   * instruments read. Every value is resent each tick rather than only the
   * changed ones, so the samples are evenly spaced and a plot can draw them
   * without having to guess at the gaps.
   */
  | { t: 'fields'; at: number; values: Record<string, number> }
  | { t: 'statustext'; severity: number; text: string }
  /**
   * Other aircraft, as a whole picture rather than a stream of reports.
   *
   * A snapshot of everything currently heard, sent at a fixed low rate: a
   * transponder receiver in busy airspace produces a report per aircraft per
   * second and ArduPilot forwards all of them, so a per-message event would
   * be tens of store writes a second to move markers that move slowly.
   */
  | { t: 'traffic'; targets: AdsbTarget[] }
  | { t: 'inspector'; rows: InspectorRow[] }
  | { t: 'commandAck'; command: number; result: number }
  | { t: 'linkStats'; stats: LinkStats }
  | { t: 'paramProgress'; got: number; total: number; source: 'ftp' | 'stream' }
  /** A file coming off the vehicle over MAVFTP -- a log, mostly. */
  | { t: 'fileProgress'; path: string; got: number; total: number }
  | { t: 'missionProgress'; got: number; total: number; dir: 'read' | 'write' }
  | {
      t: 'magCalProgress'
      compassId: number
      calStatus: number
      pct: number
      completionMask: number[]
    }
  | { t: 'magCalReport'; compassId: number; calStatus: number; fitness: number; autosaved: number }
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
  | { k: 'attitude'; rollRad: number; pitchRad: number; yawRad: number }
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
  | { k: 'gps'; fixType: number; satellites: number; hdop: number }
  | { k: 'rc'; channels: number[]; rssi: number }
  | { k: 'sensors'; present: number; enabled: number; health: number }
  /**
   * Where the vehicle is in its mission, as the vehicle sees it.
   *
   * Two messages, kept as one fact because they answer one question and
   * either can arrive without the other: MISSION_CURRENT says which item is
   * being flown, NAV_CONTROLLER_OUTPUT says how far away it is. A field is
   * null when the message carrying it has not arrived.
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
 * One mission item, in wire terms: x and y are latitude and longitude in
 * degrees * 1e7 (MISSION_ITEM_INT's fixed-point form -- floats lose meters of
 * precision at earth scale, which is why the float message is deprecated).
 * Sequence 0 is home by ArduPilot convention; the vehicle replaces its
 * content with the real home at arming, so what a plan carries there is the
 * *planned* home, a reference point rather than a command.
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
