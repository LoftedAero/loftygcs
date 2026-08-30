// The transport façade (the Betaflight configurator pattern): one interface,
// swappable backends, exactly one active at a time. Transports move bytes
// and know nothing about MAVLink.

export type TransportKind = 'serial' | 'tcp' | 'udp' | 'ws' | 'virtual'

export type TransportOptions =
  | { kind: 'serial'; baudRate: number }
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'udp'; localPort: number; host?: string; port?: number }
  | { kind: 'ws'; url: string }
  | { kind: 'virtual' }

export interface Transport {
  readonly kind: TransportKind
  /** Rejects with a user-readable Error if the link cannot be opened. */
  open(opts: TransportOptions): Promise<void>
  close(): Promise<void>
  write(bytes: Uint8Array): void
  onData(cb: (bytes: Uint8Array) => void): void
  onClose(cb: (reason?: string) => void): void
}

export class TransportError extends Error {}
