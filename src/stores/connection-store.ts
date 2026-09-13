import { create } from 'zustand'
import type { LinkStats } from '../protocol/types'
import type { TransportKind } from '../transport/Transport'

// Read-only mirror of the connection service's state machine, for the UI.
// Mutations happen only in services/connection.ts.
export type ConnectionPhase =
  | 'idle'
  | 'opening'
  | 'handshaking' // link open, waiting for the first vehicle HEARTBEAT
  | 'connected'
  | 'linkLost' // no HEARTBEAT for 3 s; the link may recover
  | 'rebooting' // we asked the vehicle to restart; waiting for it to come back
  | 'error'

interface ConnectionState {
  phase: ConnectionPhase
  kind: TransportKind | null
  error: string | null
  linkStats: LinkStats | null
  /** What the transport selector shows; persists across connections. */
  selectedKind: TransportKind
  setSelectedKind: (k: TransportKind) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  phase: 'idle',
  kind: null,
  error: null,
  linkStats: null,
  selectedKind: 'serial',
  setSelectedKind: (selectedKind) => set({ selectedKind }),
}))

export function setConnectionState(
  patch: Partial<Pick<ConnectionState, 'phase' | 'kind' | 'error' | 'linkStats'>>,
) {
  useConnectionStore.setState(patch)
}
