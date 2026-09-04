// The protocol engine: the single stateful object between raw link bytes and
// typed events. Environment-agnostic by construction -- it runs inside the
// app's Web Worker and, identically, in plain Node for tests and SITL
// integration runs.
import { MavFramer, encodeFrame } from './frames'
import { decodeFrameFields } from './serializer'
import { collectFields } from './fields'
import { messageToDeltas } from './telemetry'
import { MavFtpClient, type FtpDirEntry } from './ftp/mavftp'
import { decodeParamPck } from './params/pck'
import { ParamStreamClient } from './params/param-client'
import { CommandClient } from './commands'
import { MissionClient } from './mission'
import type {
  DecodedMessage,
  EngineOutput,
  FieldValue,
  MissionItem,
  ParamDownloadResult,
  TelemetryDelta,
} from './types'

// GCS identity on the link. 255 is the conventional GCS system id;
// 190 is MAV_COMP_ID_MISSIONPLANNER, the generic GCS component.
const GCS_SYSID = 255
const GCS_COMPID = 190

const HEARTBEAT_INTERVAL_MS = 1000
const TELEMETRY_FLUSH_MS = 50
// Slower than the instrument path: a status list and a plot do not need
// twenty updates a second, and this one carries every field the vehicle has
// ever sent rather than a handful.
const FIELDS_FLUSH_MS = 100
const LINKSTATS_INTERVAL_MS = 1000
// 4 Hz for every stream: plenty for readouts, gentle on telemetry radios.
const STREAM_RATE_HZ = 4

/** Smallest gap between file-transfer progress events, in milliseconds. */
const PROGRESS_INTERVAL_MS = 100

export class ProtocolEngine {
  private framer = new MavFramer()
  private seq = 0
  private running = false
  private timers: ReturnType<typeof setInterval>[] = []
  private pendingDeltas: TelemetryDelta[] = []
  private fieldValues = new Map<string, number>()
  private lastHeartbeatAt = -1
  private vehicleSysid: number | null = null
  private vehicleCompid = 1
  private streamsRequested = false
  private lastStats = { frames: 0, droppedBytes: 0, badFrames: 0 }

  // MAVFTP is a fast path, not a requirement: a 500 ms op timeout makes the
  // capability probe fail fast on firmware without it, instead of the
  // "hanging on param MAVFTP" stall Mission Planner is known for.
  private ftp = new MavFtpClient((payload) => this.sendFtpPayload(payload), 500)
  private paramStream = new ParamStreamClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
  )
  private commands = new CommandClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
  )
  private mission = new MissionClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
  )

  constructor(private emit: (out: EngineOutput) => void) {}

  start() {
    if (this.running) return
    this.running = true
    // ArduPilot needs to see a GCS heartbeat: failsafes key off GCS link
    // loss, and some firmware won't stream to a silent peer.
    this.timers.push(setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS))
    this.timers.push(setInterval(() => this.flushTelemetry(), TELEMETRY_FLUSH_MS))
    this.timers.push(setInterval(() => this.flushFields(), FIELDS_FLUSH_MS))
    this.timers.push(setInterval(() => this.reportLinkStats(), LINKSTATS_INTERVAL_MS))
    this.sendHeartbeat()
  }

  stop() {
    this.running = false
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.pendingDeltas = []
    this.lastHeartbeatAt = -1
    this.vehicleSysid = null
    this.streamsRequested = false
    this.ftp.abort('link closed')
    this.paramStream.abort('link closed')
    this.commands.abort('link closed')
    this.mission.abort('link closed')
  }

  pushBytes(bytes: Uint8Array) {
    for (const frame of this.framer.push(bytes)) {
      const decoded = decodeFrameFields(frame.msgid, frame.payload)
      if (!decoded) continue
      this.handleMessage({
        msgid: frame.msgid,
        msgName: decoded.msgName,
        sysid: frame.sysid,
        compid: frame.compid,
        seq: frame.seq,
        fields: decoded.fields,
      })
    }
  }

  send(msgName: string, fields: Record<string, FieldValue>) {
    const bytes = encodeFrame(msgName, fields, this.seq++ & 0xff, GCS_SYSID, GCS_COMPID)
    this.emit({ t: 'tx', bytes })
  }

  private handleMessage(msg: DecodedMessage) {
    // Before the switch: every message contributes to the generic field set,
    // including the ones handled specially below.
    collectFields(msg, this.fieldValues)
    // Ignore our own reflected traffic (UDP loops and some bridges echo).
    if (msg.sysid === GCS_SYSID) return

    switch (msg.msgName) {
      case 'HEARTBEAT': {
        // Components other than the autopilot (gimbals, companion computers)
        // also heartbeat; the vehicle is compid 1.
        if (msg.compid !== 1) return
        this.lastHeartbeatAt = Date.now()
        if (this.vehicleSysid === null) {
          this.vehicleSysid = msg.sysid
          this.vehicleCompid = msg.compid
        }
        this.emit({
          t: 'evt',
          evt: {
            t: 'heartbeat',
            sysid: msg.sysid,
            compid: msg.compid,
            vehicleType: msg.fields.type as number,
            autopilot: msg.fields.autopilot as number,
            baseMode: msg.fields.baseMode as number,
            customMode: msg.fields.customMode as number,
            systemStatus: msg.fields.systemStatus as number,
          },
        })
        if (!this.streamsRequested) {
          this.streamsRequested = true
          this.requestStreams()
        }
        return
      }
      case 'STATUSTEXT':
        this.emit({
          t: 'evt',
          evt: {
            t: 'statustext',
            severity: msg.fields.severity as number,
            text: msg.fields.text as string,
          },
        })
        return
      case 'PARAM_VALUE':
        this.paramStream.handleParamValue(msg.fields)
        return
      case 'FILE_TRANSFER_PROTOCOL':
        this.ftp.handlePayload(msg.fields.payload as number[])
        return
      case 'MISSION_COUNT':
      case 'MISSION_ITEM_INT':
      case 'MISSION_REQUEST':
      case 'MISSION_REQUEST_INT':
      case 'MISSION_ACK':
        this.mission.handleMessage(msg.msgName, msg.fields)
        return
      case 'COMMAND_ACK':
        this.commands.handleAck(msg.fields)
        this.emit({
          t: 'evt',
          evt: {
            t: 'commandAck',
            command: msg.fields.command as number,
            result: msg.fields.result as number,
          },
        })
        return
      case 'MAG_CAL_PROGRESS':
        this.emit({
          t: 'evt',
          evt: {
            t: 'magCalProgress',
            compassId: msg.fields.compassId as number,
            calStatus: msg.fields.calStatus as number,
            pct: msg.fields.completionPct as number,
            completionMask: msg.fields.completionMask as number[],
          },
        })
        return
      case 'MAG_CAL_REPORT':
        this.emit({
          t: 'evt',
          evt: {
            t: 'magCalReport',
            compassId: msg.fields.compassId as number,
            calStatus: msg.fields.calStatus as number,
            fitness: msg.fields.fitness as number,
            autosaved: msg.fields.autosaved as number,
          },
        })
        return
      default:
        this.pendingDeltas.push(...messageToDeltas(msg))
    }
  }

  private sendHeartbeat() {
    // MAV_TYPE_GCS(6) / MAV_AUTOPILOT_INVALID(8) / MAV_STATE_ACTIVE(4).
    this.send('HEARTBEAT', {
      type: 6,
      autopilot: 8,
      baseMode: 0,
      customMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3,
    })
  }

  private requestStreams() {
    if (this.vehicleSysid === null) return
    // Legacy stream request; it still works on every ArduPilot version and
    // is one message. Per-message SET_MESSAGE_INTERVAL tuning can come with
    // the flight screen, which is the first thing that needs higher rates.
    this.send('REQUEST_DATA_STREAM', {
      targetSystem: this.vehicleSysid,
      targetComponent: this.vehicleCompid,
      reqStreamId: 0, // MAV_DATA_STREAM_ALL
      reqMessageRate: STREAM_RATE_HZ,
      startStop: 1,
    })
  }

  private sendFtpPayload(payload: number[]) {
    this.send('FILE_TRANSFER_PROTOCOL', {
      targetNetwork: 0,
      targetSystem: this.vehicleSysid ?? 1,
      targetComponent: this.vehicleCompid,
      payload,
    })
  }

  /** MAVFTP fast path with automatic fallback to the message stream. */
  async downloadParams(): Promise<ParamDownloadResult> {
    try {
      const blob = await this.ftp.readFile('@PARAM/param.pck', (got, total) =>
        this.emit({ t: 'evt', evt: { t: 'paramProgress', got, total, source: 'ftp' } }),
      )
      const { params } = decodeParamPck(blob)
      if (params.length === 0) throw new Error('param.pck decoded to zero parameters')
      return { source: 'ftp', params }
    } catch {
      // Old firmware, FTP disabled, or a flaky link: the stream always works.
      const params = await this.paramStream.downloadAll((got, total) =>
        this.emit({ t: 'evt', evt: { t: 'paramProgress', got, total, source: 'stream' } }),
      )
      return { source: 'stream', params }
    }
  }

  setParam(name: string, value: number, mavType: number): Promise<number> {
    return this.paramStream.setParam(name, value, mavType)
  }

  runCommand(command: number, params: number[], timeoutMs?: number): Promise<number> {
    return this.commands.run(command, params, timeoutMs !== undefined ? { timeoutMs } : {})
  }

  /** List a directory on the vehicle's filesystem, over MAVFTP. */
  listFiles(path: string): Promise<FtpDirEntry[]> {
    return this.ftp.listDirectory(path)
  }

  /**
   * Read a file off the vehicle.
   *
   * Progress is reported per chunk because a dataflash log is megabytes
   * over a link that may be a telemetry radio -- a transfer with no visible
   * progress is indistinguishable from one that has hung.
   */
  downloadFile(path: string): Promise<Uint8Array> {
    // Throttled: a burst read delivers a packet every third of a
    // millisecond, and a ten-megabyte log produced forty-three thousand
    // progress events -- each one a postMessage, a store write and a
    // render, to move a bar by a quarter of a pixel. Ten a second is more
    // than the eye resolves and the last one is always sent.
    let lastAt = 0
    return this.ftp.readFile(path, (got, total) => {
      const now = Date.now()
      if (got < total && now - lastAt < PROGRESS_INTERVAL_MS) return
      lastAt = now
      this.emit({ t: 'evt', evt: { t: 'fileProgress', path, got, total } })
    })
  }

  downloadMission(missionType: number): Promise<MissionItem[]> {
    return this.mission.download(missionType, (got, total) =>
      this.emit({ t: 'evt', evt: { t: 'missionProgress', got, total, dir: 'read' } }),
    )
  }

  uploadMission(items: MissionItem[], missionType: number): Promise<void> {
    return this.mission.upload(items, missionType, (got, total) =>
      this.emit({ t: 'evt', evt: { t: 'missionProgress', got, total, dir: 'write' } }),
    )
  }

  clearMission(missionType: number): Promise<void> {
    return this.mission.clearAll(missionType)
  }

  private flushFields() {
    if (this.fieldValues.size === 0) return
    this.emit({
      t: 'evt',
      evt: { t: 'fields', at: Date.now(), values: Object.fromEntries(this.fieldValues) },
    })
  }

  private flushTelemetry() {
    if (this.pendingDeltas.length === 0) return
    const batch = this.pendingDeltas
    this.pendingDeltas = []
    this.emit({ t: 'evt', evt: { t: 'telemetry', batch } })
  }

  private reportLinkStats() {
    const s = this.framer.stats
    this.emit({
      t: 'evt',
      evt: {
        t: 'linkStats',
        stats: {
          rxCount: s.frames - this.lastStats.frames,
          droppedBytes: s.droppedBytes - this.lastStats.droppedBytes,
          badFrames: s.badFrames - this.lastStats.badFrames,
          heartbeatAgeMs: this.lastHeartbeatAt < 0 ? -1 : Date.now() - this.lastHeartbeatAt,
        },
      },
    })
    this.lastStats = { ...s }
  }
}
