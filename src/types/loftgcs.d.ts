// The entire surface the Electron preload exposes. The browser build sees
// `window.loftgcs === undefined`; everything else in the renderer is shared.
export type LinkId = number

export interface LinkOpenOptions {
  kind: 'tcp' | 'udp'
  host?: string
  port: number
  localPort?: number
}

export interface SimStatus {
  /** Prebuilt SITL binaries exist for this platform (Windows only today). */
  supported: boolean
  vehicles: { id: string; label: string }[]
  installed: string[]
  running: string | null
  port: number
}

export interface LoftGcsBridge {
  platform: string
  link: {
    open(opts: LinkOpenOptions): Promise<LinkId>
    write(id: LinkId, data: Uint8Array): void
    close(id: LinkId): Promise<void>
    onData(cb: (id: LinkId, data: Uint8Array) => void): () => void
    onClose(cb: (id: LinkId, error?: string) => void): () => void
  }
  serialPicker: {
    // Electron's select-serial-port flow: main forwards the candidate list,
    // the renderer shows its own chooser and answers with a portId (or '').
    onPortsAvailable(cb: (ports: SerialPortChoice[]) => void): () => void
    choose(portId: string): void
    cancel(): void
  }
  /** A locally managed ArduPilot SITL, for demos and testing without hardware. */
  sim: {
    status(): Promise<SimStatus>
    install(vehicle: string): Promise<void>
    /** Spawns SITL and resolves with the TCP port once it is accepting. */
    start(vehicle: string): Promise<number>
    stop(): Promise<void>
    onProgress(cb: (p: { file: string; done: number; total: number }) => void): () => void
    onLog(cb: (line: string) => void): () => void
    onExit(cb: () => void): () => void
  }

  app: {
    getVersion(): Promise<string>
    openExternal(url: string): void
    /** Main-process fetch, restricted to firmware.ardupilot.org (no CORS there). */
    fetchFirmware(url: string): Promise<ArrayBuffer>
  }

  /**
   * HUD video. The main process speaks RTSP or listens for RTP and passes
   * the compressed H.264 bitstream over; the renderer decodes it with
   * WebCodecs. Decoded frames are far too large to cross a process boundary.
   */
  video: {
    open(url: string): Promise<{ ok: true } | { ok: false; error: string }>
    close(): Promise<{ ok: true }>
    onReady(cb: (info: { codec: string }) => void): () => void
    onUnit(
      cb: (u: { data: Uint8Array; keyframe: boolean; timestamp: number }) => void,
    ): () => void
    onStatus(cb: (s: { text: string; error?: boolean; closed?: boolean }) => void): () => void
  }
}

declare global {
  /**
   * One candidate from Electron's select-serial-port list. Deliberately not
   * `SerialPortInfo`: that name is taken by the Web Serial DOM type, which
   * carries only usbVendorId/usbProductId and is a different thing.
   */
  interface SerialPortChoice {
    portId: string
    portName: string
    /** The OS product string, when the device supplies one. */
    displayName?: string
    /** USB ids, as the platform reports them. */
    vendorId?: string
    productId?: string
    serialNumber?: string
  }

  interface Window {
    loftgcs?: LoftGcsBridge
  }
}

export {}
