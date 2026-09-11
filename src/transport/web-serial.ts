// USB serial via the Web Serial API. This one file serves both homes: the
// browser (Chrome/Edge/Firefox 151+) and Electron, whose select-serial-port
// handler feeds the same requestPort() call. That symmetry is the whole
// reason the app codes to Web Serial instead of node-serialport.
import { TransportError, type Transport, type TransportOptions } from './Transport'

/**
 * Ports this origin has already been granted, newest grant last.
 *
 * `requestPort()` needs a user gesture and shows a chooser; `getPorts()`
 * needs neither, and returns whatever the browser (or Electron's device
 * permission handler) already said yes to. It is the only way to touch a
 * port without asking, which is what board detection wants -- and it is
 * best-effort by nature: a fresh profile has granted nothing, so an empty
 * list is the normal case and not an error.
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
 * Ask for a port once and keep it.
 *
 * Every `requestPort()` is a chooser in somebody's face, so a flow that
 * needs the same device twice must acquire it once and pass it around.
 * `identifyBoard` used to let the transport ask for itself, which put the
 * *same* port chooser up twice for the *same* board -- once to probe it,
 * once to reboot it -- and that is what a flash looked like from the
 * outside.
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
 * The chooser was dismissed without a port.
 *
 * Its own type because it is not a failure: pressing Cancel on a port picker
 * is choosing not to continue, and a caller that cannot tell it from "the
 * board did not answer" ends up asking a follow-up question to somebody who
 * has just said no.
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
   * @param chosen A port already in hand -- from `grantedSerialPorts()` --
   * which skips the chooser entirely. Omit it and the user picks.
   */
  constructor(private readonly chosen?: SerialPort) {}

  /**
   * The port this transport is open on, so a flow that needs the same
   * device again can hand it to the next transport instead of asking.
   * Null before `open` and after `close`; read it while it is open.
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
