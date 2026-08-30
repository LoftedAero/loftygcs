// USB serial via the Web Serial API. This one file serves both homes: the
// browser (Chrome/Edge/Firefox 151+) and Electron, whose select-serial-port
// handler feeds the same requestPort() call. That symmetry is the whole
// reason the app codes to Web Serial instead of node-serialport.
import { TransportError, type Transport, type TransportOptions } from './Transport'

export class WebSerialTransport implements Transport {
  readonly kind = 'serial' as const
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private closeCb: ((reason?: string) => void) | null = null
  private closing = false

  async open(opts: TransportOptions): Promise<void> {
    if (opts.kind !== 'serial') throw new TransportError('wrong options for serial transport')
    if (!('serial' in navigator)) {
      throw new TransportError(
        'Web Serial is not available in this browser. Use Chrome, Edge, or Firefox 151+, or the desktop app.',
      )
    }
    // Must be called from a user gesture; the browser (or our Electron
    // chooser modal) shows the port picker.
    let port: SerialPort
    try {
      port = await navigator.serial.requestPort()
    } catch {
      throw new TransportError('No serial port selected.')
    }
    await port.open({ baudRate: opts.baudRate })
    this.port = port
    this.writer = port.writable?.getWriter() ?? null
    this.closing = false
    void this.readLoop()
  }

  private async readLoop() {
    // Streams-style read loop: each successful read hands the chunk to the
    // byte pump. A device unplug surfaces as an error or a done -- both end
    // the loop and report the close upward exactly once.
    while (this.port?.readable && !this.closing) {
      const reader = this.port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value && value.length > 0) this.dataCb?.(value)
        }
      } catch (err) {
        if (!this.closing) {
          this.closeCb?.(err instanceof Error ? err.message : 'serial read error')
          this.closing = true
        }
      } finally {
        reader.releaseLock()
      }
    }
    if (!this.closing) this.closeCb?.('serial port closed')
  }

  write(bytes: Uint8Array) {
    void this.writer?.write(bytes)
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      await this.reader?.cancel()
    } catch {
      // Canceling an already-errored reader throws; the port is going away
      // either way.
    }
    try {
      this.writer?.releaseLock()
      await this.port?.close()
    } catch {
      // Same story: a surprise-removed device cannot be closed cleanly.
    }
    this.port = null
    this.reader = null
    this.writer = null
  }

  onData(cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void) {
    this.closeCb = cb
  }
}
