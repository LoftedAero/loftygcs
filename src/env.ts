// Runtime environment detection. The browser, Electron and Android builds
// share one renderer; features probe here for what exists rather than forking
// the build.
import { Capacitor } from '@capacitor/core'

export function isElectron(): boolean {
  return typeof window !== 'undefined' && 'loftgcs' in window
}

export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

/** The Android app, which brings its own native links. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

// IP links (TCP/UDP) need the Electron main process or the Android app; a
// plain browser tab cannot open raw sockets. A WebSocket bridge
// (mavlink2rest) works anywhere.
export function hasIpLinks(): boolean {
  return isElectron() || isNativeApp()
}

/** A device's own UART, such as a handheld radio's internal RF module. */
export function hasUart(): boolean {
  return isNativeApp()
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
