// The protocol engine: the single stateful object between raw link bytes and
// typed events. Environment-agnostic, so it runs in the app's Web Worker and
// in plain Node for tests and SITL integration runs.
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
import { RttEstimator } from './link-timing'
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
// Slower than the instrument path: it carries every field the vehicle has
// sent, and a status list or plot does not need 20 Hz.
const FIELDS_FLUSH_MS = 100
const LINKSTATS_INTERVAL_MS = 1000
// 4 Hz for every stream: plenty for readouts, gentle on telemetry radios.
const STREAM_RATE_HZ = 4

const MAV_CMD_SET_MESSAGE_INTERVAL = 511
/**
 * MAV_TYPEs of the vehicles that save a REQUEST_DATA_STREAM into their SRn_
 * parameters (ArduPlane, and Rover before 4.7): fixed wing, the VTOL types a
 * quadplane can report, ground rover and boat. Saving would overwrite rates
 * the user chose for the link, such as the reduced ones an ELRS link needs,
 * so these get SET_MESSAGE_INTERVAL, which is never saved.
 */
const SAVES_STREAM_RATES = new Set([1, 10, 11, 19, 20, 21, 22, 23, 24, 25])
/** The messages the app displays, as [msgid, Hz], most important first. */
const MESSAGE_RATES_HZ: readonly [number, number][] = [
  [30, 4], // ATTITUDE
  [33, 4], // GLOBAL_POSITION_INT
  [74, 4], // VFR_HUD
  [1, 2], // SYS_STATUS
  [24, 2], // GPS_RAW_INT
  [147, 1], // BATTERY_STATUS
  [65, 2], // RC_CHANNELS
  [36, 2], // SERVO_OUTPUT_RAW
  [62, 2], // NAV_CONTROLLER_OUTPUT
  [42, 1], // MISSION_CURRENT
]
/** A link with a longer round trip gets half the message rates. */
const SLOW_LINK_RTT_MS = 400
/** How often the link round trip is measured with TIMESYNC. */
const TIMESYNC_INTERVAL_MS = 2000
/**
 * How long a parameter download waits for the first round-trip measurement.
 * MAVFTP's short timeouts would otherwise give up on a slow link before it
 * was measured, and the stream fallback is several times slower.
 */
const FIRST_RTT_WAIT_MS = 3000

/** Smallest gap between file-transfer progress events, in milliseconds. */
const PROGRESS_INTERVAL_MS = 100

// Inspector snapshot interval. The EMA keeps a 1 Hz message from alternating
// between 0 and 2.5 Hz across windows.
const INSPECT_FLUSH_MS = 400
/**
 * Traffic snapshot interval and target timeout. Reports arrive about once a
 * second per aircraft; the timeout is several times that because ADS-B
 * reception drops in and out at range.
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
  // Always counted (cheap next to the decode), but only snapshotted while the
  // inspector is open.
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

  /** Measured link round trip; every client below takes its timeouts from it. */
  private rtt = new RttEstimator()
  /** Bumped on stop, so work started for one connection never runs on the next. */
  private linkGen = 0
  /** TIMESYNC requests awaiting their echo: ts1 as sent, and when. */
  private timesyncSent = new Map<bigint, number>()
  private timesyncSeq = 0

  // MAVFTP is a fast path, not a requirement: a short op timeout lets
  // firmware without it fall back quickly instead of stalling.
  private ftp = new MavFtpClient(
    (payload) => this.sendFtpPayload(payload),
    () => this.rtt.timeout(500),
  )
  private paramStream = new ParamStreamClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
    this.rtt,
  )
  private commands = new CommandClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
    this.rtt,
  )
  private mission = new MissionClient(
    (msgName, fields) => this.send(msgName, fields),
    () => ({ sysid: this.vehicleSysid ?? 1, compid: this.vehicleCompid }),
    1500,
    this.rtt,
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
    this.timers.push(setInterval(() => this.sendTimesync(), TIMESYNC_INTERVAL_MS))
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
    this.linkGen++
    this.rtt.reset()
    this.timesyncSent.clear()
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
    // Every message contributes to the generic field set, including the ones
    // handled specially below.
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
          this.sendTimesync()
          void this.requestTelemetry(msg.fields.type as number)
          this.requestVersion()
          this.requestBanner()
        }
        return
      }
      case 'AUTOPILOT_VERSION': {
        // flight_sw_version packs major, minor, patch and
        // FIRMWARE_VERSION_TYPE into one uint32, high byte first.
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
            // A uint64 that some decoders return as a BigInt; every bit in
            // use is well inside 2^53.
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
        // Kept by ICAO address and flushed as a snapshot (TRAFFIC_FLUSH_MS).
        // Reports without a valid position decode to null and are dropped.
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
      case 'TIMESYNC': {
        // A reply carries the vehicle's clock in tc1 and echoes our ts1. The
        // vehicle's own requests (tc1 = 0) are not ours to time.
        if (BigInt(msg.fields.tc1 as bigint) === 0n) return
        const ts1 = BigInt(msg.fields.ts1 as bigint)
        const sentAt = this.timesyncSent.get(ts1)
        if (sentAt === undefined) return
        this.timesyncSent.delete(ts1)
        this.rtt.sample(Date.now() - sentAt)
        return
      }
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
        // A request from the vehicle. The only one handled is the accel
        // calibration's position request; our own reflected commands were
        // dropped above.
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
            // Body-frame direction vector: where the vehicle points now.
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

  /**
   * Ask for the telemetry the app displays. Vehicles that save stream
   * requests get one SET_MESSAGE_INTERVAL per message, at half rate on a slow
   * link; the rest get the classic all-streams request. Firmware that refuses
   * SET_MESSAGE_INTERVAL gets the classic request too, saved or not.
   */
  private async requestTelemetry(vehicleType: number) {
    if (!SAVES_STREAM_RATES.has(vehicleType)) {
      this.requestAllStreams()
      return
    }
    const gen = this.linkGen
    let scale = 1
    let scaled = false
    for (let i = 0; i < MESSAGE_RATES_HZ.length; i++) {
      const [msgid, hz] = MESSAGE_RATES_HZ[i]!
      let result: number
      try {
        result = await this.commands.run(MAV_CMD_SET_MESSAGE_INTERVAL, [
          msgid,
          Math.round(1e6 / (hz * scale)),
          0,
          0,
          0,
          0,
          0,
        ])
      } catch {
        result = -1
      }
      if (gen !== this.linkGen) return
      if (i > 0) continue
      if (result !== 0) {
        this.requestAllStreams()
        return
      }
      // The first exchange has measured the link; halve everything on a slow
      // one, including the message already requested.
      if (!scaled && (this.rtt.rttMs ?? 0) > SLOW_LINK_RTT_MS) {
        scaled = true
        scale = 0.5
        i = -1
      }
    }
  }

  private requestAllStreams() {
    if (this.vehicleSysid === null) return
    // Legacy stream request: one message, and it works on every ArduPilot version.
    this.send('REQUEST_DATA_STREAM', {
      targetSystem: this.vehicleSysid,
      targetComponent: this.vehicleCompid,
      reqStreamId: 0, // MAV_DATA_STREAM_ALL
      reqMessageRate: STREAM_RATE_HZ,
      startStop: 1,
    })
  }

  /**
   * Sends MAV_CMD_REQUEST_AUTOPILOT_CAPABILITIES, answered with
   * AUTOPILOT_VERSION. Fire and forget: without an answer, parameter
   * metadata falls back to the current release.
   */
  private requestVersion() {
    if (this.vehicleSysid === null) return
    void this.commands.run(520, [1, 0, 0, 0, 0, 0, 0]).catch(() => {})
  }

  /**
   * Asks the vehicle to repeat its boot banner (MAV_CMD_DO_SEND_BANNER, as
   * Mission Planner does). The banner announces the frame, which
   * `vehicle-store` latches, and is otherwise sent only once at boot. Fire
   * and forget: only the STATUSTEXTs that follow matter.
   */
  private requestBanner() {
    if (this.vehicleSysid === null) return
    void this.commands.run(42428, [0, 0, 0, 0, 0, 0, 0]).catch(() => {})
  }

  /** Time the link: the vehicle echoes ts1, so the reply's age is the round trip. */
  private sendTimesync() {
    if (this.vehicleSysid === null) return
    const now = Date.now()
    for (const [ts, at] of this.timesyncSent) {
      if (now - at > 30000) this.timesyncSent.delete(ts)
    }
    // Unique per request, so a late echo never matches the wrong one.
    const ts1 = BigInt(now) * 1000000n + BigInt(this.timesyncSeq++ % 1000000)
    this.timesyncSent.set(ts1, now)
    this.send('TIMESYNC', {
      tc1: 0n,
      ts1,
      targetSystem: this.vehicleSysid,
      targetComponent: this.vehicleCompid,
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
    const until = Date.now() + FIRST_RTT_WAIT_MS
    while (this.rtt.rttMs === null && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50))
    }
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

  /** Stops the file read in progress (see MavFtpClient.cancelRead). */
  cancelDownload() {
    this.ftp.cancelRead()
  }

  /** Reads a file off the vehicle, reporting progress. */
  downloadFile(path: string): Promise<Uint8Array> {
    // Throttled to 10 Hz: a burst read delivers a packet every third of a
    // millisecond, and each event is a postMessage, a store write and a
    // render. The final event is always sent.
    let lastAt = 0
    return this.ftp.readFile(path, (got, total) => {
      const now = Date.now()
      if (got < total && now - lastAt < PROGRESS_INTERVAL_MS) return
      lastAt = now
      this.emit({ t: 'evt', evt: { t: 'fileProgress', path, got, total } })
    })
  }

  /**
   * Writes a file to the vehicle. Much slower than a read: there is no burst
   * write and ArduPilot serves one FTP request at a time, so this is 239
   * bytes per round trip.
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
   * Expires stale targets and sends the current traffic picture. Nothing is
   * sent while the picture stays empty (the usual case with no receiver).
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
          rttMs: this.rtt.rttMs,
        },
      },
    })
    this.lastStats = { ...s }
  }
}
