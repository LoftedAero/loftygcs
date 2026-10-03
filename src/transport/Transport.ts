// One interface with swappable backends, one active at a time (the pattern
// Betaflight Configurator uses). Transports move bytes and know nothing about
// MAVLink.

export type TransportKind = 'serial' | 'tcp' | 'udp' | 'ws' | 'uart'

export type TransportOptions =
  /**
   * `port` skips the chooser by reusing a port already granted to this origin.
   * Reopening after a commanded reboot needs it, since `requestPort()`
   * requires a user gesture.
   */
  | { kind: 'serial'; baudRate: number; port?: SerialPort }
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'udp'; localPort: number; host?: string; port?: number }
  | { kind: 'ws'; url: string }
  /** A device's own UART, such as the AX12's internal ELRS port (Android app). */
  | { kind: 'uart'; path: string; baudRate: number }

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
