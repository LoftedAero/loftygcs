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
    onPortsAvailable(cb: (ports: { portId: string; portName: string }[]) => void): () => void
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
}

declare global {
  interface Window {
    loftgcs?: LoftGcsBridge
  }
}

export {}
