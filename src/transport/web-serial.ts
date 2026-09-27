// USB serial via the Web Serial API. The same code runs in the browser
// (Chrome/Edge/Firefox 151+) and in Electron, whose select-serial-port handler
// answers the same requestPort() call; that is why the app uses Web Serial
// rather than node-serialport.
import { TransportError, type Transport, type TransportOptions } from './Transport'

/**
 * Ports this origin has already been granted, newest grant last.
 *
 * Unlike `requestPort()`, `getPorts()` needs no user gesture and shows no
 * chooser, so it is how background board detection reaches a port. An empty
 * list is normal for a fresh profile.
 */
export async function grantedSerialPorts(): Promise<SerialPort[]> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return []
  try {
    return await navigator.serial.getPorts()
  } catch {
    return []
  }
}

/**
 * Ask for a port once and keep it. Every `requestPort()` shows a chooser, so
 * a flow that needs the same device twice should acquire it once and pass it
 * along.
 */
export async function requestSerialPort(): Promise<SerialPort> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    throw new TransportError(
      'Web Serial is not available here. Use Chrome/Edge or the desktop app.',
    )
  }
  try {
    return await navigator.serial.requestPort()
  } catch {
    throw new PortCancelledError()
  }
}

/**
 * The chooser was dismissed without a port. Its own type because canceling
 * is a choice, not a failure, and callers should treat it that way.
 */
export class PortCancelledError extends TransportError {
  constructor() {
    super('No serial port selected.')
    this.name = 'PortCancelledError'
  }
}

export class WebSerialTransport implements Transport {
  readonly kind = 'serial' as const
  private port: SerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private closeCb: ((reason?: string) => void) | null = null
  private closing = false

  /**
   * @param chosen A port already in hand (from `grantedSerialPorts()`), which
   * skips the chooser. Omit it and the user picks.
   */
  constructor(private readonly chosen?: SerialPort) {}

  /**
   * The port this transport is open on, so a flow can hand it to the next
   * transport instead of asking again. Null before `open` and after `close`.
   */
  get openedPort(): SerialPort | null {
    return this.port
  }

  async open(opts: TransportOptions): Promise<void> {
    if (opts.kind !== 'serial') throw new TransportError('wrong options for serial transport')
    if (!('serial' in navigator)) {
      throw new TransportError(
        'Web Serial is not available in this browser. Use Chrome, Edge, or Firefox 151+, or the desktop app.',
      )
    }
    // Must be called from a user gesture; the browser (or our Electron
    // chooser modal) shows the port picker. A port handed to the
    // constructor was granted earlier and needs neither.
    let port: SerialPort
    if (this.chosen) {
      port = this.chosen
    } else {
      try {
        port = await navigator.serial.requestPort()
      } catch {
        throw new PortCancelledError()
      }
    }
    await port.open({ baudRate: opts.baudRate })
    this.port = port
    this.writer = port.writable?.getWriter() ?? null
    this.closing = false
    void this.readLoop()
  }

  private async readLoop() {
    // A device unplug surfaces as an error or as done; either ends the loop
    // and reports the close exactly once.
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
      // A surprise-removed device cannot be closed cleanly.
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
