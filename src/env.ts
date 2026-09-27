// Runtime environment detection. The browser and Electron builds share one
// renderer; features probe here for what exists rather than forking the build.
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

/**
 * Open a link outside the app.
 *
 * In Electron the main process vets the scheme and hands it to the OS
 * browser; target="_blank" would open a bare BrowserWindow with the app's
 * privileges.
 */
export function openExternal(url: string): void {
  if (window.loftgcs) window.loftgcs.app.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}
