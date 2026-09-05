// The connection service: owns the transport manager, the protocol worker,
// and the state machine between them. This is the single writer of
// connection-store and vehicle-store; the UI calls connect()/disconnect()
// and reads the stores.
import { TransportManager } from '../transport'
import { useInspectorStore } from '../stores/inspector-store'
import type { TransportOptions } from '../transport/Transport'
import { WorkerClient } from '../worker/worker-client'
import type { MissionItem, ProtocolEvent, TelemetryDelta } from '../protocol/types'
import { modeName, vehicleTypeName } from '../protocol/modes'
import { setConnectionState, useConnectionStore } from '../stores/connection-store'
import { useVehicleStore, type VehicleSnapshot } from '../stores/vehicle-store'
import { useParamStore } from '../stores/param-store'
import { useCalStore } from '../stores/cal-store'
import { useMissionStore } from '../stores/mission-store'
import { useLogStore } from '../stores/log-store'
import { telemetryRings } from './telemetry-ring'
import { fieldRegistry } from './telemetry-fields'
import { fetchParamMetadata } from './param-metadata'

const HANDSHAKE_TIMEOUT_MS = 5000
const LINK_LOST_AFTER_MS = 3000
const SNAPSHOT_INTERVAL_MS = 200

class ConnectionService {
  private manager = new TransportManager()
  private worker: WorkerClient | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private snapshotTimer: ReturnType<typeof setInterval> | null = null
  // Deltas mutate this between snapshot flushes so the store re-renders at
  // a few Hz no matter how fast telemetry arrives.
  private pending: Partial<VehicleSnapshot> = {}
  private pendingDirty = false

  async connect(opts: TransportOptions) {
    const { phase } = useConnectionStore.getState()
    if (phase !== 'idle' && phase !== 'error') await this.disconnect()

    setConnectionState({ phase: 'opening', kind: opts.kind, error: null })
    try {
      const worker = this.ensureWorker()
      await this.manager.open(
        opts,
        (bytes) => worker.pushBytes(bytes),
        (reason) => this.onTransportClosed(reason),
      )
      worker.start()
      setConnectionState({ phase: 'handshaking' })
      this.handshakeTimer = setTimeout(() => {
        // A silent link usually means wrong baud/port -- or a board sitting
        // in its bootloader, which the firmware flow will learn to detect.
        void this.disconnect(
          'No heartbeat received. Check the connection settings, and that the board is running ArduPilot.',
        )
      }, HANDSHAKE_TIMEOUT_MS)
      this.snapshotTimer = setInterval(() => this.flushSnapshot(), SNAPSHOT_INTERVAL_MS)
    } catch (err) {
      setConnectionState({
        phase: 'error',
        error: err instanceof Error ? err.message : 'Connection failed',
      })
    }
  }

  async disconnect(error?: string) {
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
    useCalStore.getState().magCalReset()
    setConnectionState(
      error
        ? { phase: 'error', error, linkStats: null }
        : { phase: 'idle', kind: null, error: null, linkStats: null },
    )
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
    void this.disconnect(reason ? `Link closed: ${reason}` : undefined)
  }

  private onEvent(evt: ProtocolEvent) {
    const conn = useConnectionStore.getState()
    switch (evt.t) {
      case 'heartbeat': {
        if (conn.phase === 'handshaking' || conn.phase === 'linkLost') {
          if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
          this.handshakeTimer = null
          setConnectionState({ phase: 'connected' })
          if (conn.phase === 'handshaking') {
            // A configurator without the parameters is an empty shell:
            // fetch them (and their metadata) as soon as the vehicle exists.
            void this.refreshParams()
            void this.loadMetadata(vehicleTypeName(evt.vehicleType))
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
      case 'fileProgress': {
        // Only meaningful while the Logs screen asked for a file; anything
        // else fetching over FTP (the parameter blob) has its own progress.
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
        useCalStore.getState().magCalProgress(evt.pct, evt.calStatus)
        return
      case 'magCalReport':
        useCalStore.getState().magCalReport({
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
        telemetryRings.rollRad.push(d.rollRad)
        telemetryRings.pitchRad.push(d.pitchRad)
        telemetryRings.yawRad.push(d.yawRad)
        p.rollRad = d.rollRad
        p.pitchRad = d.pitchRad
        p.yawRad = d.yawRad
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
      case 'gps':
        p.gpsFix = d.fixType
        p.gpsSats = d.satellites
        p.gpsHdop = d.hdop
        break
      case 'rc':
        p.rcChannels = d.channels
        p.rcRssi = d.rssi
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

  async refreshParams() {
    const worker = this.worker
    if (!worker) return
    const store = useParamStore.getState()
    store.beginDownload()
    try {
      const result = await worker.downloadParams()
      useParamStore.getState().loaded(result.params)
    } catch (err) {
      useParamStore.getState().failed(err instanceof Error ? err.message : 'param download failed')
    }
  }

  private async loadMetadata(vehicleName: string) {
    try {
      useParamStore.getState().setMetadata(await fetchParamMetadata(vehicleName))
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

  /** Write every dirty parameter, confirming each against the echo. */
  async writeDirtyParams(): Promise<{ written: number; failed: string[] }> {
    const worker = this.worker
    if (!worker) return { written: 0, failed: [] }
    const store = useParamStore.getState()
    store.setWriteBusy(true)
    const failed: string[] = []
    let written = 0
    try {
      for (const [name, e] of store.entries) {
        if (!e.dirty) continue
        try {
          const echoed = await worker.setParam(name, e.value, e.mavType)
          useParamStore.getState().confirmWrite(name, echoed)
          written++
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
