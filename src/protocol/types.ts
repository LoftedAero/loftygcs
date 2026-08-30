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
  | { t: 'statustext'; severity: number; text: string }
  | { t: 'commandAck'; command: number; result: number }
  | { t: 'linkStats'; stats: LinkStats }
  | { t: 'paramProgress'; got: number; total: number; source: 'ftp' | 'stream' }
  | {
      t: 'magCalProgress'
      compassId: number
      calStatus: number
      pct: number
      completionMask: number[]
    }
  | { t: 'magCalReport'; compassId: number; calStatus: number; fitness: number; autosaved: number }

export type TelemetryDelta =
  | { k: 'attitude'; rollRad: number; pitchRad: number; yawRad: number }
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
  | { k: 'rc'; channels: number[] }
  | { k: 'sensors'; present: number; enabled: number; health: number }

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

export interface ParamDownloadResult {
  source: 'ftp' | 'stream'
  params: ParamRecord[]
}

/** Request/response operations on the protocol worker. */
export type EngineRequest =
  | { op: 'downloadParams' }
  | { op: 'setParam'; name: string; value: number; mavType: number }
  | { op: 'command'; command: number; params: number[]; timeoutMs?: number }

/** Messages into the protocol worker. */
export type EngineCommand =
  | { t: 'rx'; bytes: Uint8Array }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'send'; msgName: string; fields: Record<string, FieldValue> }
  | ({ t: 'req'; id: number } & EngineRequest)

/** Messages out of the protocol worker. */
export type EngineOutput =
  | { t: 'tx'; bytes: Uint8Array }
  | { t: 'evt'; evt: ProtocolEvent }
  | { t: 'res'; id: number; ok: true; data: unknown }
  | { t: 'res'; id: number; ok: false; error: string }
