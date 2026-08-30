// Raw MAVLink over a WebSocket -- works identically in the browser and
// Electron, which makes it the network path for the zero-install build
// (mavlink-server and similar bridges expose exactly this).
import { TransportError, type Transport, type TransportOptions } from './Transport'

export class WebSocketTransport implements Transport {
  readonly kind = 'ws' as const
  private socket: WebSocket | null = null
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private closeCb: ((reason?: string) => void) | null = null
  private closing = false

  async open(opts: TransportOptions): Promise<void> {
    if (opts.kind !== 'ws') throw new TransportError('wrong options for ws transport')
    const socket = new WebSocket(opts.url)
    socket.binaryType = 'arraybuffer'
    this.closing = false
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () =>
        reject(new TransportError(`Could not connect to ${opts.url}. Is the bridge running?`))
    })
    socket.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) this.dataCb?.(new Uint8Array(e.data))
    }
    socket.onclose = () => {
      if (!this.closing) this.closeCb?.('WebSocket closed')
    }
    socket.onerror = null
    this.socket = socket
  }

  write(bytes: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(bytes)
  }

  async close(): Promise<void> {
    this.closing = true
    this.socket?.close()
    this.socket = null
  }

  onData(cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void) {
    this.closeCb = cb
  }
}
