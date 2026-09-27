// The connection service: owns the transport manager, the protocol worker,
// and the state machine between them. This is the single writer of
// connection-store and vehicle-store; the UI calls connect()/disconnect()
// and reads the stores.
import { TransportManager } from '../transport'
import { useInspectorStore } from '../stores/inspector-store'
import { useTrafficStore } from '../stores/traffic-store'
import type { TransportOptions } from '../transport/Transport'
import { WorkerClient } from '../worker/worker-client'
import type { FirmwareVersion, MissionItem, ProtocolEvent, TelemetryDelta } from '../protocol/types'
import { modeName, vehicleTypeName } from '../protocol/modes'
import { mergeServoOutputs } from '../protocol/telemetry'
import { setConnectionState, useConnectionStore } from '../stores/connection-store'
import { describeLinkError, describeSilentLink } from './link-error'
import { WebSerialTransport, grantedSerialPorts } from '../transport/web-serial'
import { rebootCandidates, siblingsOf } from './reboot-port'
import { useVehicleStore, type VehicleSnapshot } from '../stores/vehicle-store'
import { useParamStore } from '../stores/param-store'
import { useCalStore } from '../stores/cal-store'
import { useMissionStore } from '../stores/mission-store'
import { useFilesStore } from '../stores/files-store'
import { useLogStore } from '../stores/log-store'
import { telemetryRings } from './telemetry-ring'
import { fieldRegistry } from './telemetry-fields'
import { fetchParamMetadata } from './param-metadata'

/**
 * How long to hold the metadata fetch for AUTOPILOT_VERSION.
 *
 * Long enough for one command round trip on a slow radio, short enough that
 * a vehicle which never answers still gets its hints while the parameter
 * table is still loading.
 */
const VERSION_WAIT_MS = 3000

const HANDSHAKE_TIMEOUT_MS = 5000
const LINK_LOST_AFTER_MS = 3000
const SNAPSHOT_INTERVAL_MS = 200

/**
 * How long to wait for a vehicle we told to restart.
 *
 * ArduPilot is back on the bus in a few seconds; the budget is generous
 * because a USB flight controller re-enumerates on its own schedule, and a
 * board that boots slowly is not a board that has failed. Past it, the
 * silence is news.
 */
const REBOOT_RETURN_MS = 45000

/** How often to try the link again while waiting for it. */
const REBOOT_RETRY_MS = 1000

class ConnectionService {
  private manager = new TransportManager()
  private worker: WorkerClient | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  /** Held while waiting for AUTOPILOT_VERSION to pick matching metadata. */
  private metadataTimer: ReturnType<typeof setTimeout> | null = null
  private metadataVehicle = ''
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  // Deltas mutate this between snapshot flushes so the store re-renders at
  // a few Hz no matter how fast telemetry arrives.
  /** What the current link was opened with, for naming it in a message. */
  private openedWith: TransportOptions | null = null
  /**
   * The serial port this link is open on, so a reboot can reopen *it*.
   *
   * Web Serial's grant belongs to the device and outlives the reboot, but
   * only a port already in hand can be opened without a chooser.
   */
  private openedPort: SerialPort | null = null
  /**
   * Where the port picked by hand sits among the ports sharing its USB ids --
   * a Cube's MAVLink and SLCAN ports are one pair of ids -- which is how the
   * same one is found again after a reboot. See `reboot-port.ts`.
   */
  private serialRank = 0
  /** Reopened ports that opened but sent no heartbeat, during this reboot. */
  private rebootSkip = 0
  /** When to stop waiting for a reboot we commanded; 0 when not waiting. */
  private rebootUntil = 0
  private rebootTimer: ReturnType<typeof setTimeout> | null = null
  private pending: Partial<VehicleSnapshot> = {}
  private pendingDirty = false

  async connect(opts: TransportOptions) {
    const { phase } = useConnectionStore.getState()
    if (phase !== 'idle' && phase !== 'error') await this.disconnect()

    setConnectionState({ phase: 'opening', kind: opts.kind, error: null })
    try {
      await this.openLink(opts)
    } catch (err) {
      // Cancelling the port chooser is not a failure, and reported as one it
      // left a red chip on the app bar for choosing not to connect.
      const error = describeLinkError(err, opts)
      setConnectionState(
        error === null ? { phase: 'idle', kind: null, error: null } : { phase: 'error', error },
      )
    }
  }

  /**
   * Open the transport and start waiting for a heartbeat.
   *
   * Split out of `connect` because the reboot wait below opens the same link
   * over and over, and must not announce each attempt as a new connection or
   * report each failure as one.
   */
  private async openLink(opts: TransportOptions) {
    this.openedWith = opts
    const worker = this.ensureWorker()
    const transport = await this.manager.open(
      opts,
      (bytes) => worker.pushBytes(bytes),
      (reason) => this.onTransportClosed(reason),
    )
    worker.start()
    this.openedPort = transport instanceof WebSerialTransport ? transport.openedPort : null
    // Only for a port somebody chose. During a reboot wait the port is one this
    // code chose from the rank, and measuring it again would only repeat it.
    const chosen = this.openedPort
    if (chosen && !this.rebooting) {
      void grantedSerialPorts().then((ports) => {
        this.serialRank = Math.max(0, siblingsOf(ports, chosen).indexOf(chosen))
      })
    }
    // While a reboot is outstanding the bar keeps saying so: the link coming
    // up is a step in that rather than a separate event, and flicking
    // through "Waiting for heartbeat" on every retry would read as a link
    // that cannot make up its mind.
    if (!this.rebooting) setConnectionState({ phase: 'handshaking' })
    this.handshakeTimer = setTimeout(() => {
      // A silent link usually means wrong baud/port -- or a board sitting
      // in its bootloader, which the firmware flow will learn to detect.
      // On serial the port itself narrows that down: a flight controller's
      // own USB vendor going quiet is far more likely to be the wrong one
      // of its several ports than a dead board.
      const usb =
        opts.kind === 'serial' && transport instanceof WebSerialTransport
          ? transport.openedPort?.getInfo()
          : undefined
      // During a reboot wait, a port that opened and said nothing is the wrong
      // sibling -- a Cube's SLCAN port, say -- so the next try starts past it.
      if (this.rebooting) this.rebootSkip++
      this.linkFailed(describeSilentLink(usb))
    }, HANDSHAKE_TIMEOUT_MS)
    this.snapshotTimer = setInterval(() => this.flushSnapshot(), SNAPSHOT_INTERVAL_MS)
  }

  private get rebooting(): boolean {
    return Date.now() < this.rebootUntil
  }

  /**
   * The next link drop is one we asked for.
   *
   * Called before the reboot command goes out, because the vehicle obeys it
   * without acking and the USB device can be gone before the promise
   * settles. Until this existed, restarting a board after a compass
   * calibration -- which this app *tells* people to do -- put "Link closed:
   * The device has been lost" on the app bar in red: the app reporting its
   * own instruction as a fault, and leaving the reconnect to be done by
   * hand.
   *
   * Harmless when the reboot is refused (an armed vehicle): the link never
   * drops and the next heartbeat clears the phase a second later.
   */
  expectReboot() {
    const { phase } = useConnectionStore.getState()
    if (phase === 'idle' || phase === 'error') return
    this.rebootUntil = Date.now() + REBOOT_RETURN_MS
    this.rebootSkip = 0
    setConnectionState({ phase: 'rebooting', error: null })
  }

  /**
   * A link that went away: a step in a reboot, or news.
   *
   * Everything that ends a link badly comes through here, so that
   * distinction is made in exactly one place.
   */
  private linkFailed(message?: string) {
    if (!this.rebooting) {
      void this.disconnect(message)
      return
    }
    void this.teardown().then(() => {
      setConnectionState({ phase: 'rebooting', error: null, linkStats: null })
      this.scheduleRebootRetry()
    })
  }

  private scheduleRebootRetry() {
    if (this.rebootTimer) clearTimeout(this.rebootTimer)
    this.rebootTimer = setTimeout(() => void this.retryAfterReboot(), REBOOT_RETRY_MS)
  }

  /**
   * Try the link again, and keep trying until the vehicle is back.
   *
   * **Opening it is the probe.** `getPorts()` lists what this origin was
   * granted whether or not the device is plugged in -- measured, in the
   * flash path -- so it cannot say when the board came back. `open()` can:
   * it fails while the device is away and succeeds the moment it is not.
   */
  private async retryAfterReboot() {
    this.rebootTimer = null
    if (useConnectionStore.getState().phase !== 'rebooting') return
    const opts = this.openedWith
    if (opts) {
      // Each candidate in turn within one try: a stale object from before the
      // reboot cannot open, and stepping over it here beats waiting a second
      // to learn the same thing again.
      for (const candidate of await this.rebootOptions(opts)) {
        try {
          await this.openLink(candidate)
          return
        } catch {
          // Normal for the first several seconds: the device re-enumerates
          // when the firmware's USB stack is up, and not before.
        }
      }
    }
    if (!this.rebooting) {
      await this.disconnect('The vehicle did not come back after the reboot. Reconnect to retry.')
      return
    }
    this.scheduleRebootRetry()
  }

  /**
   * The links to try after a reboot, best first, each with a port attached so
   * no chooser is needed.
   *
   * Serial ports are matched by USB ids and chosen by rank among them rather
   * than by "the newest match", which on a Cube Orange was its SLCAN port: see
   * `reboot-port.ts`. A port with no USB ids to match on (Bluetooth, a virtual
   * COM port) has only the object in hand.
   */
  private async rebootOptions(opts: TransportOptions): Promise<TransportOptions[]> {
    if (opts.kind !== 'serial') return [opts]
    const held = this.openedPort
    if (!held) return [opts]
    const siblings = siblingsOf(await grantedSerialPorts(), held)
    const ports = rebootCandidates(siblings, this.serialRank, this.rebootSkip)
    return (ports.length > 0 ? ports : [held]).map((port) => ({ ...opts, port }))
  }

  async disconnect(error?: string) {
    // Disconnecting is an answer to the question the reboot wait is asking.
    this.rebootUntil = 0
    if (this.rebootTimer) clearTimeout(this.rebootTimer)
    this.rebootTimer = null
    await this.teardown()
    setConnectionState(
      error
        ? { phase: 'error', error, linkStats: null }
        : { phase: 'idle', kind: null, error: null, linkStats: null },
    )
  }

  /** Everything a disconnect does except say so: shared with the reboot wait. */
  private async teardown() {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.snapshotTimer) clearInterval(this.snapshotTimer)
    this.handshakeTimer = null
    this.snapshotTimer = null
    this.worker?.stop()
    await this.manager.close()
    this.pending = {}
    this.pendingDirty = false
    useVehicleStore.getState().reset()
    useParamStore.getState().reset()
    // Otherwise the next vehicle inherits the last one's field list, and a
    // plot keeps drawing a line that belongs to an aircraft that is gone.
    fieldRegistry.clear()
    // Same reason: traffic belongs to the aircraft that heard it. Leaving it
    // on the map would show the last flight's sky over the next field.
    useTrafficStore.getState().clear()
    useCalStore.getState().magCalReset()
    useCalStore.getState().setAccelAsked(null)
  }

  private ensureWorker(): WorkerClient {
    if (this.worker) return this.worker
    const worker = new WorkerClient()
    worker.onTx((bytes) => this.manager.write(bytes))
    worker.onEvent((evt) => this.onEvent(evt))
    this.worker = worker
    return worker
  }

  private onTransportClosed(reason?: string) {
    // The reason is a socket error message from the main process, so it gets
    // the same cleaning a failed open does -- a link dropped mid-flight is
    // exactly when nobody wants to read "ECONNRESET" off the app bar. The
    // options are the ones this link was opened with.
    const opts = this.openedWith
    const said = reason && opts ? describeLinkError(new Error(reason), opts) : reason
    this.linkFailed(said ? `Link closed: ${said}` : undefined)
  }

  private onEvent(evt: ProtocolEvent) {
    const conn = useConnectionStore.getState()
    switch (evt.t) {
      case 'heartbeat': {
        if (
          conn.phase === 'handshaking' ||
          conn.phase === 'linkLost' ||
          conn.phase === 'rebooting'
        ) {
          if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
          this.handshakeTimer = null
          // Back. A link that never dropped -- a telemetry radio, or a
          // reboot the vehicle refused -- recovers here too, which is why
          // the wait ends on a heartbeat rather than on a port.
          this.rebootUntil = 0
          setConnectionState({ phase: 'connected' })
          if (conn.phase === 'handshaking' || conn.phase === 'rebooting') {
            // A configurator without the parameters is an empty shell:
            // fetch them as soon as the vehicle exists -- and again once a
            // restart is over, which is the whole point of the restart. Both
            // kinds of reboot need it for different reasons: a link that
            // dropped had the parameter set cleared with it, so the screens
            // would come back empty; a link that never dropped is holding
            // values from before the vehicle re-read its own storage. Not
            // `linkLost` -- nothing restarted there, and re-downloading
            // 1,400 parameters over a radio that just recovered is the last
            // thing that link needs.
            void this.refreshParams()
          }
          if (conn.phase === 'handshaking') {
            // Metadata survives a reboot (`reset` leaves it alone) and the
            // firmware has not changed, so this is first-connection only.
            // It waits a moment for AUTOPILOT_VERSION, because the
            // version picks which metadata to fetch. Only a moment: a
            // vehicle that never answers still gets hints, just the
            // current release's, which is what it got before this existed.
            this.metadataVehicle = vehicleTypeName(evt.vehicleType)
            this.metadataTimer = setTimeout(() => {
              this.metadataTimer = null
              void this.loadMetadata(this.metadataVehicle, null)
            }, VERSION_WAIT_MS)
          }
        }
        this.pending.present = true
        this.pending.sysid = evt.sysid
        this.pending.vehicleName = vehicleTypeName(evt.vehicleType)
        this.pending.vehicleType = evt.vehicleType
        this.pending.modeName = modeName(evt.vehicleType, evt.customMode)
        this.pending.customMode = evt.customMode
        this.pending.armed = (evt.baseMode & 128) !== 0
        this.pending.systemStatus = evt.systemStatus
        this.pendingDirty = true
        return
      }
      case 'telemetry':
        for (const d of evt.batch) this.applyDelta(d)
        return
      case 'version': {
        useVehicleStore
          .getState()
          .apply({ firmware: evt.firmware, capabilities: evt.capabilities, boardId: evt.boardId })
        // The answer we were holding the metadata fetch for.
        if (this.metadataTimer) {
          clearTimeout(this.metadataTimer)
          this.metadataTimer = null
          void this.loadMetadata(this.metadataVehicle, evt.firmware)
        }
        return
      }
      case 'fileProgress': {
        // Whichever screen asked for a file: the Files browser and the Logs
        // screen both transfer over the same FTP client, and anything else
        // using it (the parameter blob) has its own progress.
        const files = useFilesStore.getState()
        if (files.transfer) {
          files.setTransfer({
            ...files.transfer,
            got: evt.got,
            total: files.transfer.total || evt.total,
          })
        }
        const log = useLogStore.getState()
        if (log.vehicleStatus.kind === 'downloading') {
          log.setVehicleStatus({
            kind: 'downloading',
            name: log.vehicleStatus.name,
            got: evt.got,
            // The listing's size is the one to trust: MAVFTP reports the
            // size it opened the file with, which agrees, but a zero from
            // either would divide a progress bar by nothing.
            total: log.vehicleStatus.total || evt.total,
          })
        }
        return
      }
      case 'inspector':
        useInspectorStore.getState().applyRows(evt.rows)
        return
      case 'traffic':
        useTrafficStore.getState().applyTargets(evt.targets)
        return
      case 'statustext':
        useVehicleStore
          .getState()
          .appendStatusText({ severity: evt.severity, text: evt.text, at: Date.now() })
        return
      case 'fields':
        fieldRegistry.apply(evt.at, evt.values)
        return
      case 'linkStats':
        setConnectionState({ linkStats: evt.stats })
        if (conn.phase === 'connected' && evt.stats.heartbeatAgeMs > LINK_LOST_AFTER_MS) {
          setConnectionState({ phase: 'linkLost' })
        }
        return
      case 'paramProgress':
        useParamStore.getState().setProgress(evt)
        return
      case 'missionProgress':
        useMissionStore
          .getState()
          .setTransfer({ kind: 'busy', dir: evt.dir, got: evt.got, total: evt.total })
        return
      case 'magCalProgress':
        // Keyed by compass: ArduPilot calibrates every used compass from one
        // command and they progress at different rates.
        useCalStore
          .getState()
          .magCalProgress(evt.compassId, evt.pct, evt.calStatus, evt.completionMask, evt.direction)
        return
      case 'accelCalPosition':
        useCalStore.getState().setAccelAsked(evt.position)
        return
      case 'magCalReport':
        useCalStore.getState().magCalReport(evt.compassId, {
          calStatus: evt.calStatus,
          fitness: evt.fitness,
          autosaved: evt.autosaved,
        })
        return
      case 'commandAck':
        // Command tracking arrives with the calibration wizards (Phase 3).
        return
    }
  }

  private applyDelta(d: TelemetryDelta) {
    const p = this.pending
    switch (d.k) {
      case 'attitude':
        // Compass calibration counts turns from these, and only while one is
        // running -- the store's own guard, so nothing accumulates in the
        // background.
        useCalStore.getState().magCalAttitude(d.rollRad, d.pitchRad, {
          rollRateRad: d.rollRateRad,
          pitchRateRad: d.pitchRateRad,
          yawRateRad: d.yawRateRad,
        })
        telemetryRings.rollRad.push(d.rollRad)
        telemetryRings.pitchRad.push(d.pitchRad)
        telemetryRings.yawRad.push(d.yawRad)
        p.rollRad = d.rollRad
        p.pitchRad = d.pitchRad
        p.yawRad = d.yawRad
        break
      case 'gimbal':
        p.gimbal = { rollDeg: d.rollDeg, pitchDeg: d.pitchDeg, yawDeg: d.yawDeg }
        break
      case 'position':
        telemetryRings.latDeg.push(d.latDeg)
        telemetryRings.lonDeg.push(d.lonDeg)
        telemetryRings.relAltM.push(d.relAltM)
        telemetryRings.headingDeg.push(d.headingDeg)
        p.latDeg = d.latDeg
        p.lonDeg = d.lonDeg
        p.altMslM = d.altMslM
        p.relAltM = d.relAltM
        p.headingDeg = d.headingDeg
        break
      case 'hud':
        telemetryRings.groundspeedMs.push(d.groundspeedMs)
        p.airspeedMs = d.airspeedMs
        p.groundspeedMs = d.groundspeedMs
        p.throttlePct = d.throttlePct
        p.climbMs = d.climbMs
        break
      case 'battery':
        telemetryRings.batteryV.push(d.voltageV)
        p.batteryV = d.voltageV
        p.batteryA = d.currentA
        p.batteryPct = d.remainingPct
        break
      case 'batteryStatus':
        // Merged, like the servo ports: each monitor arrives in its own
        // message, and a batch holding one must keep the others'.
        p.batteries = {
          ...(p.batteries ?? useVehicleStore.getState().batteries),
          [d.id]: { voltageV: d.voltageV, currentA: d.currentA, remainingPct: d.remainingPct },
        }
        break
      case 'gps':
        p.gpsFix = d.fixType
        p.gpsSats = d.satellites
        p.gpsHdop = d.hdop
        break
      case 'rc':
        p.rcChannels = d.channels
        p.rcRssi = d.rssi
        break
      case 'servoOutputs':
        // Merged rather than assigned: the two ports arrive as separate
        // messages, usually in the same batch, and each must keep the other's.
        p.servoOutputsUs = mergeServoOutputs(
          p.servoOutputsUs ?? useVehicleStore.getState().servoOutputsUs,
          d.port,
          d.valuesUs,
        )
        break
      case 'missionProgress':
        // Each message fills its own half; a null leaves the last value
        // standing rather than blanking a readout that is still true.
        if (d.seq !== null) p.missionSeq = d.seq
        if (d.wpDistM !== null) p.wpDistM = d.wpDistM
        if (d.altErrorM !== null) p.altErrorM = d.altErrorM
        break
      case 'sensors':
        p.sensorsPresent = d.present
        p.sensorsEnabled = d.enabled
        p.sensorsHealth = d.health
        break
    }
    this.pendingDirty = true
  }

  private flushSnapshot() {
    if (!this.pendingDirty) return
    useVehicleStore.getState().apply(this.pending)
    this.pending = {}
    this.pendingDirty = false
  }

  /**
   * Re-read every parameter.
   *
   * `quiet` is for a refresh nobody asked for out loud -- writing a
   * parameter that gates a whole subtree, where the point is to discover
   * what the vehicle now exposes. It keeps the screen showing what it has:
   * no `beginDownload`, so no curated tab blanks to a loading card; the new
   * set is *merged*, so staged edits survive; and a failure is dropped,
   * because a background read that could not complete is not a reason to
   * put the Parameters tab into an error state.
   */
  async refreshParams(opts: { quiet?: boolean } = {}) {
    const worker = this.worker
    if (!worker) return
    if (!opts.quiet) useParamStore.getState().beginDownload()
    try {
      const result = await worker.downloadParams()
      const store = useParamStore.getState()
      if (opts.quiet) store.merged(result.params)
      else store.loaded(result.params)
    } catch (err) {
      // A quiet refresh that could not finish leaves the screen as it was --
      // but the progress bar has to stop, or the bar reads as a download
      // still running.
      if (opts.quiet) {
        useParamStore.setState({ progress: null })
        return
      }
      useParamStore.getState().failed(err instanceof Error ? err.message : 'param download failed')
    }
  }

  private async loadMetadata(vehicleName: string, firmware: FirmwareVersion | null) {
    try {
      const { params, source } = await fetchParamMetadata(vehicleName, firmware)
      useParamStore.getState().setMetadata(params, source)
    } catch {
      // Metadata is decoration; offline or firewalled is not an error state.
    }
  }

  /** Fire-and-forget message send (position targets and the like). */
  sendMessage(msgName: string, fields: Record<string, number | string | number[]>) {
    this.worker?.send(msgName, fields)
  }

  /** Run a MAV_CMD, resolving with the MAV_RESULT code (0 = accepted). */
  /** Watch (or stop watching) raw link traffic; costs nothing while off. */
  setInspecting(on: boolean): void {
    this.worker?.setInspecting(on)
  }

  runCommand(command: number, params: number[] = [], timeoutMs?: number): Promise<number> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.runCommand(command, params, timeoutMs)
  }

  /** Set one parameter immediately (wizards; the Params tab stages instead). */
  async setParamNow(name: string, value: number): Promise<number> {
    const worker = this.worker
    if (!worker) throw new Error('not connected')
    const entry = useParamStore.getState().entries.get(name)
    const echoed = await worker.setParam(name, value, entry?.mavType ?? 9)
    useParamStore.getState().confirmWrite(name, echoed)
    return echoed
  }

  /** List a directory on the vehicle's filesystem over MAVFTP. */
  listFiles(path: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.listFiles(path)
  }

  /** Read a file off the vehicle. Progress arrives as fileProgress events. */
  downloadFile(path: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.downloadFile(path)
  }

  /** Stop the file read in progress. The download rejects as canceled. */
  cancelDownload() {
    return this.worker?.cancelDownload() ?? Promise.resolve()
  }

  /** Write a file to the vehicle. Progress arrives as fileProgress events. */
  uploadFile(path: string, bytes: Uint8Array) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.uploadFile(path, bytes)
  }

  removeFile(path: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.removeFile(path)
  }

  createDirectory(path: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.createDirectory(path)
  }

  removeDirectory(path: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.removeDirectory(path)
  }

  renameFile(from: string, to: string) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.renameFile(from, to)
  }

  /** Read the vehicle's stored mission (or fence, or rally). */
  downloadMission(missionType = 0) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.downloadMission(missionType)
  }

  /** Replace the vehicle's mission. Items must start with home at seq 0. */
  uploadMission(items: MissionItem[], missionType = 0) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.uploadMission(items, missionType)
  }

  /** Forget the stored mission (or fence, or rally) entirely. */
  clearMission(missionType = 0) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('not connected'))
    return worker.clearMission(missionType)
  }

  /**
   * Write every dirty parameter, confirming each against the echo.
   *
   * The names that went are reported alongside the count: the page has the
   * metadata and can tell from them whether a reboot is now the next step,
   * which a number cannot.
   */
  /**
   * Send every staged edit, or only the ones a caller claims.
   *
   * The scope exists because a screen can hold more than one card that edits
   * parameters, and a button labelled "Write (14)" on one of them must not
   * quietly send the other's edits too. Callers without a scope -- the action
   * bar, the parameters column -- still send everything, which is what those
   * buttons have always meant.
   */
  async writeDirtyParams(
    owns?: (param: string) => boolean,
  ): Promise<{ written: string[]; failed: string[] }> {
    const worker = this.worker
    if (!worker) return { written: [], failed: [] }
    const store = useParamStore.getState()
    store.setWriteBusy(true)
    const failed: string[] = []
    const written: string[] = []
    try {
      for (const [name, e] of store.entries) {
        if (!e.dirty) continue
        if (owns && !owns(name)) continue
        try {
          const echoed = await worker.setParam(name, e.value, e.mavType)
          useParamStore.getState().confirmWrite(name, echoed)
          written.push(name)
        } catch {
          failed.push(name)
        }
      }
    } finally {
      useParamStore.getState().setWriteBusy(false)
    }
    return { written, failed }
  }
}

export const connectionService = new ConnectionService()
