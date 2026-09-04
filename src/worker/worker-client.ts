// Typed wrapper around the protocol worker: the only way the rest of the
// renderer talks MAVLink. Owning the Worker here means connection teardown
// has exactly one thing to terminate.
// ?worker&inline bundles the worker into the main chunk (base64 -> blob).
// Costs some bundle size, but one build then runs everywhere the app has to
// live: http, file:// inside Electron, and the single-file artifact/demo
// build where a separate worker chunk has no URL to load from.
import ProtocolWorker from './protocol.worker?worker&inline'
import type {
  EngineCommand,
  EngineOutput,
  EngineRequest,
  FieldValue,
  MissionItem,
  ParamDownloadResult,
  ProtocolEvent,
} from '../protocol/types'
import type { FtpDirEntry } from '../protocol/ftp/mavftp'

export class WorkerClient {
  private worker: Worker
  private eventListeners = new Set<(evt: ProtocolEvent) => void>()
  private txListeners = new Set<(bytes: Uint8Array) => void>()
  private nextReqId = 1
  private pendingReqs = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (e: Error) => void }
  >()

  constructor() {
    this.worker = new ProtocolWorker()
    this.worker.onmessage = (e: MessageEvent<EngineOutput>) => {
      const out = e.data
      if (out.t === 'tx') {
        for (const cb of this.txListeners) cb(out.bytes)
      } else if (out.t === 'res') {
        const p = this.pendingReqs.get(out.id)
        if (!p) return
        this.pendingReqs.delete(out.id)
        if (out.ok) p.resolve(out.data)
        else p.reject(new Error(out.error))
      } else {
        for (const cb of this.eventListeners) cb(out.evt)
      }
    }
  }

  private request(req: EngineRequest): Promise<unknown> {
    const id = this.nextReqId++
    return new Promise((resolve, reject) => {
      this.pendingReqs.set(id, { resolve, reject })
      this.post({ t: 'req', id, ...req })
    })
  }

  downloadParams(): Promise<ParamDownloadResult> {
    return this.request({ op: 'downloadParams' }) as Promise<ParamDownloadResult>
  }

  setParam(name: string, value: number, mavType: number): Promise<number> {
    return this.request({ op: 'setParam', name, value, mavType }) as Promise<number>
  }

  /** Resolves with the MAV_RESULT code (0 = accepted). */
  runCommand(command: number, params: number[] = [], timeoutMs?: number): Promise<number> {
    return this.request({
      op: 'command',
      command,
      params,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    }) as Promise<number>
  }

  downloadMission(missionType = 0): Promise<MissionItem[]> {
    return this.request({ op: 'downloadMission', missionType }) as Promise<MissionItem[]>
  }

  uploadMission(items: MissionItem[], missionType = 0): Promise<void> {
    return this.request({ op: 'uploadMission', items, missionType }) as Promise<void>
  }

  /** List a directory on the vehicle over MAVFTP. */
  listFiles(path: string): Promise<FtpDirEntry[]> {
    return this.request({ op: 'listFiles', path }) as Promise<FtpDirEntry[]>
  }

  /**
   * Read a file off the vehicle. Progress arrives as `fileProgress` events
   * rather than a callback, which cannot cross the worker boundary.
   */
  downloadFile(path: string): Promise<Uint8Array> {
    return this.request({ op: 'downloadFile', path }) as Promise<Uint8Array>
  }

  clearMission(missionType = 0): Promise<void> {
    return this.request({ op: 'clearMission', missionType }) as Promise<void>
  }

  start() {
    this.post({ t: 'start' })
  }

  stop() {
    this.post({ t: 'stop' })
  }

  pushBytes(bytes: Uint8Array) {
    // Transfer: the transport hands us a fresh buffer per read.
    this.worker.postMessage({ t: 'rx', bytes } satisfies EngineCommand, [bytes.buffer])
  }

  send(msgName: string, fields: Record<string, FieldValue>) {
    this.post({ t: 'send', msgName, fields })
  }

  onEvent(cb: (evt: ProtocolEvent) => void): () => void {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  onTx(cb: (bytes: Uint8Array) => void): () => void {
    this.txListeners.add(cb)
    return () => this.txListeners.delete(cb)
  }

  terminate() {
    this.worker.terminate()
    this.eventListeners.clear()
    this.txListeners.clear()
  }

  private post(cmd: EngineCommand) {
    this.worker.postMessage(cmd)
  }
}
