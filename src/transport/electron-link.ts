// TCP and UDP transports over the Electron IPC bridge (window.loftgcs.link).
// One class serves both kinds; the main process owns the actual sockets
// (electron/ipc-links.ts). Data for other link ids is filtered out here so
// a stale link's late packets can never reach the parser.
import { TransportError, type Transport, type TransportOptions } from './Transport'

export class ElectronLinkTransport implements Transport {
  readonly kind: 'tcp' | 'udp'
  private id: number | null = null
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private closeCb: ((reason?: string) => void) | null = null
  private unsubs: (() => void)[] = []

  constructor(kind: 'tcp' | 'udp') {
    this.kind = kind
  }

  async open(opts: TransportOptions): Promise<void> {
    const bridge = window.loftgcs
    if (!bridge) {
      throw new TransportError('TCP/UDP links need the desktop app (browsers cannot open raw sockets).')
    }
    if (opts.kind !== this.kind) throw new TransportError('wrong options for link transport')

    try {
      if (opts.kind === 'tcp') {
        this.id = await bridge.link.open({ kind: 'tcp', host: opts.host, port: opts.port })
      } else {
        this.id = await bridge.link.open({
          kind: 'udp',
          port: opts.port ?? opts.localPort,
          localPort: opts.localPort,
          ...(opts.host !== undefined ? { host: opts.host } : {}),
        })
      }
    } catch (err) {
      throw new TransportError(
        err instanceof Error ? `Could not open ${this.kind.toUpperCase()} link: ${err.message}` : 'link open failed',
      )
    }

    this.unsubs.push(
      bridge.link.onData((id, data) => {
        if (id === this.id) this.dataCb?.(new Uint8Array(data))
      }),
      bridge.link.onClose((id, error) => {
        if (id === this.id) this.closeCb?.(error)
      }),
    )
  }

  write(bytes: Uint8Array) {
    if (this.id !== null) window.loftgcs?.link.write(this.id, bytes)
  }

  async close(): Promise<void> {
    for (const u of this.unsubs) u()
    this.unsubs = []
    if (this.id !== null) await window.loftgcs?.link.close(this.id)
    this.id = null
  }

  onData(cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void) {
    this.closeCb = cb
  }
}
