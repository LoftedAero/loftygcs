// Runtime environment detection. The renderer is one codebase; what differs
// between the browser and Electron is which capabilities exist, so features
// probe here instead of forking the build.
export function isElectron(): boolean {
  return typeof window !== 'undefined' && 'loftgcs' in window
}

export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

// IP links (TCP/UDP) need the Electron main process; a plain browser tab
// cannot open raw sockets. A WebSocket bridge (mavlink2rest) works anywhere.
export function hasIpLinks(): boolean {
  return isElectron()
}
