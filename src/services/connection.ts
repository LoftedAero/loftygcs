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
 * How long to hold the metadata fetch for AUTOPILOT_VERSION: one command
 * round trip on a slow radio, and still short of a parameter download.
 */
const VERSION_WAIT_MS = 3000

const HANDSHAKE_TIMEOUT_MS = 5000
const LINK_LOST_AFTER_MS = 3000
const SNAPSHOT_INTERVAL_MS = 200

/**
 * How long to wait for a vehicle we told to restart. ArduPilot is usually
 * back in a few seconds, but a USB flight controller re-enumerates on its
 * own schedule.
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
  /** What the current link was opened with, for naming it in a message. */
  private openedWith: TransportOptions | null = null
  /**
   * The serial port this link is open on, so a reboot can reopen it without
   * a chooser. Web Serial's grant belongs to the device and outlives the
   * reboot.
   */
  private openedPort: SerialPort | null = null
  /**
   * The chosen port's index among ports sharing its USB ids (a Cube's MAVLink
   * and SLCAN ports share one pair), used to find it again after a reboot.
   * See `reboot-port.ts`.
   */
  private serialRank = 0
  /** Reopened ports that opened but sent no heartbeat, during this reboot. */
  private rebootSkip = 0
  /** When to stop waiting for a reboot we commanded; 0 when not waiting. */
  private rebootUntil = 0
  private rebootTimer: ReturnType<typeof setTimeout> | null = null
  // Deltas accumulate here between snapshot flushes so the store re-renders
  // at a few Hz however fast telemetry arrives.
  private pending: Partial<VehicleSnapshot> = {}
  private pendingDirty = false

  async connect(opts: TransportOptions) {
    const { phase } = useConnectionStore.getState()
    if (phase !== 'idle' && phase !== 'error') await this.disconnect()

    setConnectionState({ phase: 'opening', kind: opts.kind, error: null })
    try {
      await this.openLink(opts)
    } catch (err) {
      // Canceling the port chooser returns to idle, not an error.
      const error = describeLinkError(err, opts)
      setConnectionState(
        error === null ? { phase: 'idle', kind: null, error: null } : { phase: 'error', error },
      )
    }
  }

  /**
   * Open the transport and start waiting for a heartbeat.
   *
   * Separate from `connect` because the reboot wait reopens the link
   * repeatedly without announcing each attempt as a new connection.
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
    // Only for a port the user chose; during a reboot wait the port was
    // picked from the rank already.
    const chosen = this.openedPort
    if (chosen && !this.rebooting) {
      void grantedSerialPorts().then((ports) => {
        this.serialRank = Math.max(0, siblingsOf(ports, chosen).indexOf(chosen))
      })
    }
    // During a reboot the phase stays 'rebooting' rather than flicking to
    // handshaking on every retry.
    if (!this.rebooting) setConnectionState({ phase: 'handshaking' })
    this.handshakeTimer = setTimeout(() => {
      // A silent link usually means the wrong baud or port, or a board in its
      // bootloader. On serial, a flight controller's own USB vendor going
      // quiet most likely means the wrong one of its several ports.
      const usb =
        opts.kind === 'serial' && transport instanceof WebSerialTransport
          ? transport.openedPort?.getInfo()
          : undefined
      // During a reboot wait, a port that opened and said nothing is the wrong
      // sibling (a Cube's SLCAN port, say), so the next try skips it.
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
   * Call before sending the reboot command: the vehicle may obey without
   * acking, and the USB device can be gone before the promise settles. The
   * drop is then treated as a reboot and reconnected automatically rather
   * than reported as a lost link.
   *
   * Harmless when the reboot is refused (an armed vehicle): the link never
   * drops and the next heartbeat clears the phase.
   */
  expectReboot() {
    const { phase } = useConnectionStore.getState()
    if (phase === 'idle' || phase === 'error') return
    this.rebootUntil = Date.now() + REBOOT_RETURN_MS
    this.rebootSkip = 0
    setConnectionState({ phase: 'rebooting', error: null })
  }

  /**
   * A link that went away, either as part of a reboot or as a failure.
   * Every abnormal link end comes through here.
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
   * Opening is the probe. `getPorts()` lists granted ports whether or not the
   * device is plugged in, so it cannot tell when the board is back; `open()`
   * fails until it is.
   */
  private async retryAfterReboot() {
    this.rebootTimer = null
    if (useConnectionStore.getState().phase !== 'rebooting') return
    const opts = this.openedWith
    if (opts) {
      // Try each candidate in turn: a stale port object from before the
      // reboot cannot open, and the next one may.
      for (const candidate of await this.rebootOptions(opts)) {
        try {
          await this.openLink(candidate)
          return
        } catch {
          // Normal for the first few seconds, until the firmware's USB stack
          // is up.
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
   * Serial ports are matched by USB ids and chosen by rank among them, not
   * by newest match, which on a Cube Orange is its SLCAN port (see
   * `reboot-port.ts`). A port with no USB ids (Bluetooth, a virtual COM
   * port) has only the object in hand.
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
    // Disconnecting ends any reboot wait.
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

  /** Everything a disconnect does except set the phase; shared with the reboot wait. */
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
    // Otherwise the next vehicle inherits the last one's plot fields.
    fieldRegistry.clear()
    // Traffic belongs to the vehicle that heard it.
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
    // The reason is a raw socket error from the main process, so it gets the
    // same cleanup as a failed open.
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
          // The wait ends on a heartbeat rather than a port, so a link that
          // never dropped (a telemetry radio, or a refused reboot) recovers
          // here too.
          this.rebootUntil = 0
          setConnectionState({ phase: 'connected' })
          if (conn.phase === 'handshaking' || conn.phase === 'rebooting') {
            // Fetch parameters on first connect and after a reboot. A link
            // that dropped had its parameters cleared; one that did not holds
            // values from before the vehicle re-read its storage. Not after
            // `linkLost`: nothing restarted, and a radio that just recovered
            // does not need 1,400 parameters pushed through it.
            void this.refreshParams()
          }
          if (conn.phase === 'handshaking') {
            // Metadata survives a reboot, so this is first-connection only.
            // It waits briefly for AUTOPILOT_VERSION to pick the matching
            // release; a vehicle that never answers gets the current one.
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
        // The Files and Logs screens share one FTP client, so update
        // whichever has a transfer running. The parameter download reports
        // its own progress.
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
            // Prefer the listing's size; either may be zero.
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
        // Keyed by compass: ArduPilot calibrates every compass from one
        // command, and they progress at different rates.
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
        return
    }
  }

  private applyDelta(d: TelemetryDelta) {
    const p = this.pending
    switch (d.k) {
      case 'attitude':
        // Compass calibration counts turns from these; the store ignores
        // them unless a calibration is running.
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
        // Merged: each monitor arrives in its own message.
        p.batteries = {
          ...(p.batteries ?? useVehicleStore.getState().batteries),
          [d.id]: {
            voltageV: d.voltageV,
            currentA: d.currentA,
            remainingPct: d.remainingPct,
            chargeState: d.chargeState,
          },
        }
        break
      case 'home':
        p.home = { latDeg: d.latDeg, lonDeg: d.lonDeg, altMslM: d.altMslM }
        break
      case 'flightState':
        p.landedState = d.landed
        break
      case 'fence':
        p.fence = { breached: d.breached, breachType: d.breachType }
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
        // Merged: the two ports arrive as separate messages.
        p.servoOutputsUs = mergeServoOutputs(
          p.servoOutputsUs ?? useVehicleStore.getState().servoOutputsUs,
          d.port,
          d.valuesUs,
        )
        break
      case 'missionProgress':
        // Each message fills its own fields; a null keeps the last value.
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
   * `quiet` is for a background refresh after writing a parameter that gates
   * others. It skips `beginDownload` so no tab blanks to a loading card,
   * merges the result so staged edits survive, and ignores failure.
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
      // A failed quiet refresh leaves the screen alone, but the progress bar
      // still has to stop.
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
      // Metadata is optional; being offline is not an error.
    }
  }

  /** Fire-and-forget message send (position targets and the like). */
  sendMessage(msgName: string, fields: Record<string, number | string | number[]>) {
    this.worker?.send(msgName, fields)
  }

  /** Watch (or stop watching) raw link traffic; costs nothing while off. */
  setInspecting(on: boolean): void {
    this.worker?.setInspecting(on)
  }

  /** Run a MAV_CMD, resolving with the MAV_RESULT code (0 = accepted). */
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
   * Write every staged edit, or only those `owns` claims, confirming each
   * against the echo.
   *
   * The scope lets one card's Write leave another card's edits alone.
   * Returns the names written so the caller can check whether any need a
   * reboot.
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
