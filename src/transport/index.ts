// Transport registry and the one-active-transport gate. Late events from a
// transport that is no longer active are dropped here, so a slow close can
// never corrupt the next connection's parse stream.
import type { Transport, TransportKind, TransportOptions } from './Transport'
import { WebSerialTransport } from './web-serial'
import { ElectronLinkTransport } from './electron-link'
import { WebSocketTransport } from './websocket'

export function createTransport(kind: TransportKind, opts?: TransportOptions): Transport {
  switch (kind) {
    case 'serial':
      // A previously granted port in the options lets a reconnect skip the
      // chooser.
      return new WebSerialTransport(opts?.kind === 'serial' ? opts.port : undefined)
    case 'tcp':
      return new ElectronLinkTransport('tcp')
    case 'udp':
      return new ElectronLinkTransport('udp')
    case 'uart':
      return new ElectronLinkTransport('uart')
    case 'ws':
      return new WebSocketTransport()
  }
}

export class TransportManager {
  private active: Transport | null = null

  async open(
    opts: TransportOptions,
    onData: (bytes: Uint8Array) => void,
    onClose: (reason?: string) => void,
  ): Promise<Transport> {
    await this.close()
    const transport = createTransport(opts.kind, opts)
    // Gate on identity: a replaced transport's events must not reach the
    // parser.
    transport.onData((bytes) => {
      if (this.active === transport) onData(bytes)
    })
    transport.onClose((reason) => {
      if (this.active === transport) onClose(reason)
    })
    // Set active before open, so bytes that arrive during open are kept.
    this.active = transport
    try {
      await transport.open(opts)
    } catch (err) {
      this.active = null
      throw err
    }
    return transport
  }

  write(bytes: Uint8Array) {
    this.active?.write(bytes)
  }

  async close() {
    const t = this.active
    this.active = null
    await t?.close()
  }

  get isOpen(): boolean {
    return this.active !== null
  }
}
