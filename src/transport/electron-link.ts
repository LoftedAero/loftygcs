// TCP, UDP and UART transports over a native link bridge: the Electron main
// process (window.loftgcs.link, electron/ipc-links.ts) or the Android app's
// plugin (native-link.ts). Either one owns the actual sockets. Data for other
// link ids is filtered out here so a stale link's late packets can never
// reach the parser.
import { TransportError, type Transport, type TransportOptions } from './Transport'
import { nativeLink, type LinkApi } from './native-link'

function linkApi(): LinkApi | null {
  return window.loftgcs?.link ?? nativeLink()
}

export class ElectronLinkTransport implements Transport {
  readonly kind: 'tcp' | 'udp' | 'uart'
  private id: number | null = null
  private dataCb: ((bytes: Uint8Array) => void) | null = null
  private closeCb: ((reason?: string) => void) | null = null
  private unsubs: (() => void)[] = []

  constructor(kind: 'tcp' | 'udp' | 'uart') {
    this.kind = kind
  }

  async open(opts: TransportOptions): Promise<void> {
    const link = linkApi()
    if (!link) {
      throw new TransportError('TCP/UDP links require the desktop app.')
    }
    if (opts.kind !== this.kind) throw new TransportError('wrong options for link transport')

    try {
      if (opts.kind === 'tcp') {
        this.id = await link.open({ kind: 'tcp', host: opts.host, port: opts.port })
      } else if (opts.kind === 'uart') {
        this.id = await link.open({ kind: 'uart', path: opts.path, baudRate: opts.baudRate })
      } else if (opts.kind === 'udp') {
        this.id = await link.open({
          kind: 'udp',
          port: opts.port ?? opts.localPort,
          localPort: opts.localPort,
          ...(opts.host !== undefined ? { host: opts.host } : {}),
        })
      }
    } catch (err) {
      throw new TransportError(
        err instanceof Error
          ? `Could not open ${this.kind.toUpperCase()} link: ${err.message}`
          : 'link open failed',
      )
    }

    this.unsubs.push(
      link.onData((id, data) => {
        if (id === this.id) this.dataCb?.(new Uint8Array(data))
      }),
      link.onClose((id, error) => {
        if (id === this.id) this.closeCb?.(error)
      }),
    )
  }

  write(bytes: Uint8Array) {
    if (this.id !== null) linkApi()?.write(this.id, bytes)
  }

  async close(): Promise<void> {
    for (const u of this.unsubs) u()
    this.unsubs = []
    if (this.id !== null) await linkApi()?.close(this.id)
    this.id = null
  }

  onData(cb: (bytes: Uint8Array) => void) {
    this.dataCb = cb
  }

  onClose(cb: (reason?: string) => void) {
    this.closeCb = cb
  }
}
