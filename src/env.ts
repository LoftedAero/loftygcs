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

/**
 * Open a link outside the app.
 *
 * In Electron the main process vets the scheme and hands it to the OS
 * browser; a plain target="_blank" there would open a bare BrowserWindow
 * with no address bar and the app's own privileges, which is both ugly and
 * a worse sandbox than the user's browser. In a real browser, window.open
 * is exactly right.
 */
export function openExternal(url: string): void {
  if (window.loftgcs) window.loftgcs.app.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}
