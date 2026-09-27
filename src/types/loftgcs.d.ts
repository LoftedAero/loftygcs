// The entire surface the Electron preload exposes. The browser build sees
// `window.loftgcs === undefined`; everything else in the renderer is shared.
import type { SimHome } from '../sim-home'

export type { SimHome }

export type LinkId = number

export interface LinkOpenOptions {
  kind: 'tcp' | 'udp'
  host?: string
  port: number
  localPort?: number
}

/**
 * How to launch a simulator; matched in electron/sitl-core.ts. Only the
 * vehicle is required: the defaults are the managed build, its own physics,
 * and a wipe.
 */
export type SimPhysics = { kind: 'builtin' } | { kind: 'flightaxis' }

export type SimParams =
  | { kind: 'keep' }
  | { kind: 'wipe' }
  /** A .parm list, applied over the defaults with a wipe so it takes. */
  | { kind: 'file'; path: string }
  /** A stored-parameter image, copied in whole. */
  | { kind: 'eeprom'; path: string }

export interface SimLaunch {
  vehicle: string
  /** A build the user supplied; unset uses the managed download. */
  exe?: string | undefined
  home?: SimHome | undefined
  physics?: SimPhysics | undefined
  params?: SimParams | undefined
}

/** What a chosen build turned out to be, read out of the binary itself. */
export interface SimBuildChoice {
  path: string
  vehicle?: string
  version?: string
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
    /**
     * The candidate list for the open request. Fires again whenever a port
     * appears or goes away while the request is open.
     */
    onPortsAvailable(cb: (ports: SerialPortChoice[]) => void): () => void
    /** Main answered the open request itself (see autoPickNew); close the chooser. */
    onDone(cb: () => void): () => void
    choose(portId: string): void
    cancel(): void
    /**
     * Answer the next port request without the chooser when exactly one new
     * port has appeared. Armed by the flash path before rebooting a board
     * into its bootloader, which enumerates as a new device. One-shot, and it
     * expires on its own.
     */
    autoPickNew(opts?: { wait?: boolean }): void
  }
  /** A locally managed ArduPilot SITL, for demos and testing without hardware. */
  sim: {
    status(): Promise<SimStatus>
    install(vehicle: string): Promise<void>
    /**
     * Spawns SITL and resolves once it is accepting on the TCP port.
     * Home is taken at boot; moving it later means restarting.
     *
     * `waitingForRealFlight`: the simulator started but nothing is on
     * RealFlight's SOAP port yet, so it will not send MAVLink until there is.
     */
    start(launch: SimLaunch): Promise<{ port: number; waitingForRealFlight: boolean }>
    stop(): Promise<void>
    /**
     * Native file pickers, since SITL needs a path rather than contents.
     * `startIn` is the folder to open at; ignored if it no longer exists.
     */
    pickBuild(startIn?: string): Promise<SimBuildChoice | null>
    pickParams(startIn?: string): Promise<string | null>
    onProgress(cb: (p: { file: string; done: number; total: number }) => void): () => void
    onLog(cb: (line: string) => void): () => void
    onExit(cb: () => void): () => void
  }

  app: {
    getVersion(): Promise<string>
    openExternal(url: string): void
    /** Main-process fetch, restricted to firmware.ardupilot.org (no CORS there). */
    fetchFirmware(url: string): Promise<ArrayBuffer>
    /**
     * Whether this window may be throttled in the background. Off while the
     * gamepad has control, since throttling pauses gamepad input and slows
     * the override stream.
     */
    setBackgroundThrottling(allowed: boolean): void
    /** The whole window's scale, Chromium's page zoom: 1 is 100%. */
    setZoomFactor(factor: number): void
  }

  /**
   * HUD video. The main process handles RTSP or RTP and passes the H.264
   * bitstream over; the renderer decodes it with WebCodecs, since decoded
   * frames are too large to cross a process boundary.
   */
  video: {
    open(url: string): Promise<{ ok: true } | { ok: false; error: string }>
    close(): Promise<{ ok: true }>
    onReady(cb: (info: { codec: string }) => void): () => void
    onUnit(cb: (u: { data: Uint8Array; keyframe: boolean; timestamp: number }) => void): () => void
    onStatus(cb: (s: { text: string; error?: boolean; closed?: boolean }) => void): () => void
  }
}

declare global {
  /**
   * One candidate from Electron's select-serial-port list. Not named
   * `SerialPortInfo`, which is the Web Serial DOM type.
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
    /** Windows only. Includes the USB interface, which separates a board's
        MAVLink port from its SLCAN one. */
    deviceInstanceId?: string
  }

  interface Window {
    loftgcs?: LoftGcsBridge
  }
}

export {}
