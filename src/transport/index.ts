// Transport registry and the one-active-transport gate. Late events from a
// transport that is no longer active are dropped here, so a slow close can
// never corrupt the next connection's parse stream.
import type { Transport, TransportKind, TransportOptions } from './Transport'
import { WebSerialTransport } from './web-serial'
import { ElectronLinkTransport } from './electron-link'
import { WebSocketTransport } from './websocket'
import { VirtualFcTransport } from './virtual-fc'

export function createTransport(kind: TransportKind, opts?: TransportOptions): Transport {
  switch (kind) {
    case 'serial':
      // A port carried in the options was granted earlier and is handed
      // straight to the transport, which is what lets a reconnect happen
      // without a chooser nobody could have answered.
      return new WebSerialTransport(opts?.kind === 'serial' ? opts.port : undefined)
    case 'tcp':
      return new ElectronLinkTransport('tcp')
    case 'udp':
      return new ElectronLinkTransport('udp')
    case 'ws':
      return new WebSocketTransport()
    case 'virtual':
      return new VirtualFcTransport()
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
    // Gate on identity: if this transport has been replaced, its events are
    // history speaking and must not reach the parser.
    transport.onData((bytes) => {
      if (this.active === transport) onData(bytes)
    })
    transport.onClose((reason) => {
      if (this.active === transport) onClose(reason)
    })
    // Set active before open: some transports (virtual) emit immediately.
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
