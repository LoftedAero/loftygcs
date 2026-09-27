import { contextBridge, ipcRenderer } from 'electron'

// The complete privileged surface the renderer gets. Everything here is
// mirrored by the LoftGcsBridge type in src/types/loftgcs.d.ts -- change
// them together.

/** One candidate from Electron's select-serial-port list. */
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

contextBridge.exposeInMainWorld('loftgcs', {
  platform: process.platform,

  link: {
    open: (opts: unknown) => ipcRenderer.invoke('link:open', opts),
    write: (id: number, data: Uint8Array) => ipcRenderer.send('link:write', id, data),
    close: (id: number) => ipcRenderer.invoke('link:close', id),
    onData: (cb: (id: number, data: Uint8Array) => void) => {
      const handler = (_e: unknown, id: number, data: Uint8Array) => cb(id, data)
      ipcRenderer.on('link:data', handler)
      return () => ipcRenderer.removeListener('link:data', handler)
    },
    onClose: (cb: (id: number, error?: string) => void) => {
      const handler = (_e: unknown, id: number, error?: string) => cb(id, error)
      ipcRenderer.on('link:close', handler)
      return () => ipcRenderer.removeListener('link:close', handler)
    },
  },

  serialPicker: {
    onPortsAvailable: (cb: (ports: SerialPortChoice[]) => void) => {
      const handler = (_e: unknown, ports: SerialPortChoice[]) => cb(ports)
      ipcRenderer.on('serial:ports', handler)
      return () => ipcRenderer.removeListener('serial:ports', handler)
    },
    choose: (portId: string) => ipcRenderer.send('serial:choose', portId),
    /** Main answered the open request itself; the chooser should close. */
    onDone: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('serial:done', handler)
      return () => ipcRenderer.removeListener('serial:done', handler)
    },
    /**
     * Answer the next port request yourself if exactly one bootloader is on
     * the machine; `wait` holds the chooser back a moment for one that is
     * still re-enumerating.
     */
    autoPickNew: (opts?: { wait?: boolean }) =>
      ipcRenderer.send('serial:auto-pick-new', opts ?? {}),
    cancel: () => ipcRenderer.send('serial:cancel'),
  },

  sim: {
    status: () => ipcRenderer.invoke('sim:status'),
    install: (vehicle: string) => ipcRenderer.invoke('sim:install', vehicle),
    start: (launch: unknown) => ipcRenderer.invoke('sim:start', launch),
    stop: () => ipcRenderer.invoke('sim:stop'),
    pickBuild: (startIn?: string) => ipcRenderer.invoke('sim:pick-build', startIn),
    pickParams: (startIn?: string) => ipcRenderer.invoke('sim:pick-params', startIn),
    onProgress: (cb: (p: { file: string; done: number; total: number }) => void) => {
      const handler = (_e: unknown, p: { file: string; done: number; total: number }) => cb(p)
      ipcRenderer.on('sim:progress', handler)
      return () => ipcRenderer.removeListener('sim:progress', handler)
    },
    onLog: (cb: (line: string) => void) => {
      const handler = (_e: unknown, line: string) => cb(line)
      ipcRenderer.on('sim:log', handler)
      return () => ipcRenderer.removeListener('sim:log', handler)
    },
    onExit: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('sim:exit', handler)
      return () => ipcRenderer.removeListener('sim:exit', handler)
    },
  },

  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    openExternal: (url: string) => ipcRenderer.send('app:open-external', url),
    fetchFirmware: (url: string) => ipcRenderer.invoke('app:fetch-firmware', url),
    setBackgroundThrottling: (allowed: boolean) =>
      ipcRenderer.send('app:background-throttling', allowed),
  },

  // Video arrives here as a compressed H.264 bitstream and is decoded in the
  // renderer: decoded frames are two orders of magnitude larger and would
  // never survive the crossing.
  video: {
    open: (url: string) => ipcRenderer.invoke('video:open', url),
    close: () => ipcRenderer.invoke('video:close'),
    onReady: (cb: (info: { codec: string }) => void) => {
      const handler = (_e: unknown, info: { codec: string }) => cb(info)
      ipcRenderer.on('video:ready', handler)
      return () => ipcRenderer.removeListener('video:ready', handler)
    },
    onUnit: (cb: (u: { data: Uint8Array; keyframe: boolean; timestamp: number }) => void) => {
      const handler = (
        _e: unknown,
        u: { data: Uint8Array; keyframe: boolean; timestamp: number },
      ) => cb(u)
      ipcRenderer.on('video:unit', handler)
      return () => ipcRenderer.removeListener('video:unit', handler)
    },
    onStatus: (cb: (s: { text: string; error?: boolean; closed?: boolean }) => void) => {
      const handler = (_e: unknown, s: { text: string; error?: boolean; closed?: boolean }) => cb(s)
      ipcRenderer.on('video:status', handler)
      return () => ipcRenderer.removeListener('video:status', handler)
    },
  },
})
