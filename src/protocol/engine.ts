// The protocol engine: the single stateful object between raw link bytes and
// typed events. Environment-agnostic by construction -- it runs inside the
// app's Web Worker and, identically, in plain Node for tests and SITL
// integration runs.
import { MavFramer, encodeFrame } from './frames'
import { decodeFrameFields } from './serializer'
import { collectFields } from './fields'
import { messageToDeltas } from './telemetry'
import { decodeAdsbVehicle, type AdsbTarget } from './adsb'
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

/** The vehicle uses this to ask for a side; the GCS uses it to answer. */
const MAV_CMD_ACCELCAL_VEHICLE_POS = 42429
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

// Inspector snapshots. 400 ms is fast enough that values visibly move and
// slow enough that a snapshot of every message type costs nothing. The EMA
// keeps a 1 Hz message from reading as 0 and 2.5 Hz on alternate windows.
const INSPECT_FLUSH_MS = 400
/**
 * How often the traffic picture goes out, and how long a target survives
 * without a fresh report.
 *
 * Reports arrive about once a second per aircraft and aeroplanes do not jump,
 * so a snapshot every second is as much as any display can use. The timeout
 * is deliberately several times that: ADS-B reception drops in and out at
 * range, and an aircraft that blinks off the map every time a report is
 * missed is worse than one drawn a few seconds stale. ArduPilot's own list
 * ages out on its side too, so a target it has genuinely lost stops arriving
 * and leaves here as well.
 */
const TRAFFIC_FLUSH_MS = 1000
const TRAFFIC_TIMEOUT_MS = 15000
const INSPECT_EMA = 0.3

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
  // Always counted -- one map upsert per message is free next to the decode
  // that already happened -- but only snapshotted while someone is looking.
  private inspectRows = new Map<
    string,
    {
      sysid: number
      compid: number
      msgid: number
      msgName: string
      count: number
      prevCount: number
      hz: number | null
      fields: Record<string, FieldValue>
    }
  >()
  private inspectTimer: ReturnType<typeof setInterval> | null = null
  /** Aircraft heard, by ICAO address. Flushed as a picture, not per report. */
  private traffic = new Map<number, AdsbTarget>()
  /** Whether the last flush said anything, so "now empty" is still said once. */
  private trafficSent = false

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
    this.timers.push(setInterval(() => this.flushTraffic(), TRAFFIC_FLUSH_MS))
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
    this.setInspecting(false)
    this.inspectRows.clear()
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

  /** Watch (or stop watching) everything on the link. */
  setInspecting(on: boolean) {
    if (on && this.inspectTimer === null) {
      this.inspectTimer = setInterval(() => this.flushInspector(), INSPECT_FLUSH_MS)
      this.flushInspector()
    } else if (!on && this.inspectTimer !== null) {
      clearInterval(this.inspectTimer)
      this.inspectTimer = null
    }
  }

  private recordForInspector(msg: DecodedMessage) {
    const key = `${msg.sysid}:${msg.compid}:${msg.msgid}`
    const row = this.inspectRows.get(key)
    if (row) {
      row.count++
      row.fields = msg.fields
    } else {
      this.inspectRows.set(key, {
        sysid: msg.sysid,
        compid: msg.compid,
        msgid: msg.msgid,
        msgName: msg.msgName,
        count: 1,
        prevCount: 0,
        hz: null,
        fields: msg.fields,
      })
    }
  }

  private flushInspector() {
    const dt = INSPECT_FLUSH_MS / 1000
    const rows = []
    for (const r of this.inspectRows.values()) {
      const instant = (r.count - r.prevCount) / dt
      r.prevCount = r.count
      r.hz = r.hz === null ? instant : r.hz * (1 - INSPECT_EMA) + instant * INSPECT_EMA
      rows.push({
        sysid: r.sysid,
        compid: r.compid,
        msgid: r.msgid,
        msgName: r.msgName,
        count: r.count,
        hz: r.hz,
        fields: r.fields,
      })
    }
    this.emit({ t: 'evt', evt: { t: 'inspector', rows } })
  }

  send(msgName: string, fields: Record<string, FieldValue>) {
    const bytes = encodeFrame(msgName, fields, this.seq++ & 0xff, GCS_SYSID, GCS_COMPID)
    this.emit({ t: 'tx', bytes })
  }

  private handleMessage(msg: DecodedMessage) {
    // Before the switch: every message contributes to the generic field set,
    // including the ones handled specially below.
    collectFields(msg, this.fieldValues)
    this.recordForInspector(msg)
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
          this.requestVersion()
          this.requestBanner()
        }
        return
      }
      case 'AUTOPILOT_VERSION': {
        // flight_sw_version packs the version into one uint32, high byte
        // first: major, minor, patch, then FIRMWARE_VERSION_TYPE. Reading
        // it as four bytes rather than as a number keeps the shift out of
        // every consumer.
        const packed = Number(msg.fields.flightSwVersion ?? 0)
        this.emit({
          t: 'evt',
          evt: {
            t: 'version',
            firmware: {
              major: (packed >>> 24) & 0xff,
              minor: (packed >>> 16) & 0xff,
              patch: (packed >>> 8) & 0xff,
              type: packed & 0xff,
            },
            // The capability field is a uint64 and arrives as a BigInt on
            // some decoders; every bit anyone uses is well inside 2^53.
            capabilities: Number(msg.fields.capabilities ?? 0),
            vendorId: Number(msg.fields.vendorId ?? 0),
            productId: Number(msg.fields.productId ?? 0),
            // `uint32_t(APJ_BOARD_ID) << 16` in GCS_Common's
            // send_autopilot_version, so the id is the top half.
            boardId: Number(msg.fields.boardVersion ?? 0) >>> 16,
          },
        })
        return
      }
      case 'ADSB_VEHICLE': {
        // Kept by ICAO address and flushed as a picture, not forwarded per
        // report -- see TRAFFIC_FLUSH_MS. A report with no valid position
        // decodes to null and is dropped here rather than stored as a target
        // that cannot be drawn.
        const target = decodeAdsbVehicle(msg.fields)
        if (target) this.traffic.set(target.icao, target)
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
      case 'COMMAND_LONG':
        // The vehicle asking the GCS for something. The only one this app
        // answers is the accelerometer calibration's position request; our
        // own outbound commands cannot be confused with it, because reflected
        // GCS traffic is dropped above.
        if (msg.fields.command === MAV_CMD_ACCELCAL_VEHICLE_POS) {
          this.emit({
            t: 'evt',
            // `_param1` is what mavlink-mappings calls this field.
            evt: { t: 'accelCalPosition', position: msg.fields._param1 as number },
          })
        }
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
            // "Body frame direction vector for display" -- where the vehicle
            // is pointing right now, which is what makes the coverage
            // picture navigable rather than merely informative.
            direction: [
              msg.fields.directionX as number,
              msg.fields.directionY as number,
              msg.fields.directionZ as number,
            ],
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

  /**
   * Ask what firmware this is.
   *
   * MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES, which every ArduPilot answers
   * with AUTOPILOT_VERSION. Fired once and forgotten: the version is used
   * to pick matching parameter metadata, and a vehicle that will not say
   * simply gets the current release's, which is what it got before this
   * existed.
   */
  private requestVersion() {
    if (this.vehicleSysid === null) return
    void this.commands.run(520, [1, 0, 0, 0, 0, 0, 0]).catch(() => {})
  }

  /**
   * Ask the vehicle to say its boot banner again.
   *
   * MAV_CMD_DO_SEND_BANNER (42428), ArduPilot's own, and what Mission
   * Planner sends for the same reason. The banner is where the **frame**
   * is announced -- "QuadPlane initialised, Frame: F-35B" -- and
   * `vehicle-store` latches that to draw the aircraft as itself rather than
   * as a generic plane.
   *
   * Without this the line is only ever heard by a GCS that happened to be
   * attached when the vehicle booted: it is sent once, and the status feed
   * is a capped ring it scrolls out of. Connect to a vehicle already
   * running -- which is the normal case -- and the app could not know what
   * it was looking at. The command is fired and forgotten like the version
   * request: a vehicle that does not implement it answers UNSUPPORTED and
   * nothing here depends on the reply, only on the STATUSTEXTs that follow.
   */
  private requestBanner() {
    if (this.vehicleSysid === null) return
    void this.commands.run(42428, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
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
  /** Stop the file read in progress -- see MavFtpClient.cancelRead. */
  cancelDownload() {
    this.ftp.cancelRead()
  }

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

  /**
   * Write a file to the vehicle -- a Lua script, an OSD font, a terrain
   * tile. Slower than a download by an order of magnitude: there is no
   * burst write, and ArduPilot serves one FTP request at a time, so this is
   * 239 bytes a round trip and the progress bar is not decoration.
   */
  async uploadFile(path: string, bytes: Uint8Array): Promise<void> {
    let lastAt = 0
    await this.ftp.writeFile(path, bytes, (sent, total) => {
      const now = Date.now()
      if (sent < total && now - lastAt < PROGRESS_INTERVAL_MS) return
      lastAt = now
      this.emit({ t: 'evt', evt: { t: 'fileProgress', path, got: sent, total } })
    })
  }

  removeFile(path: string): Promise<void> {
    return this.ftp.removeFile(path)
  }

  createDirectory(path: string): Promise<void> {
    return this.ftp.createDirectory(path)
  }

  removeDirectory(path: string): Promise<void> {
    return this.ftp.removeDirectory(path)
  }

  renameFile(from: string, to: string): Promise<void> {
    return this.ftp.rename(from, to)
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

  /**
   * The sky as it stands, and only when it has changed.
   *
   * Expiry happens here rather than on a timer of its own: this is the only
   * thing that reads the map, so a target that has aged out has not been
   * seen by anyone in the meantime. The empty-to-empty case sends nothing,
   * which is the ordinary case for every vehicle without a receiver fitted.
   */
  private flushTraffic() {
    const cutoff = Date.now() - TRAFFIC_TIMEOUT_MS
    for (const [icao, t] of this.traffic) if (t.at < cutoff) this.traffic.delete(icao)
    if (this.traffic.size === 0 && !this.trafficSent) return
    this.trafficSent = this.traffic.size > 0
    this.emit({ t: 'evt', evt: { t: 'traffic', targets: [...this.traffic.values()] } })
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
