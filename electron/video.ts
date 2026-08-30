// The video IPC surface. One source at a time, since the HUD has one
// background; opening a second replaces the first.
//
// What crosses to the renderer is the compressed bitstream, a few hundred
// KB/s. Decoding happens there, with Chromium's own hardware decoder.

import { ipcMain, type BrowserWindow } from 'electron'
import { openSource, type VideoSource } from './video/source'

let current: VideoSource | null = null

export function registerVideoHandlers(getWindow: () => BrowserWindow | null) {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  const stop = () => {
    current?.close()
    current = null
  }

  ipcMain.handle('video:open', (_evt, url: string) => {
    stop()
    try {
      const source = openSource(url)
      current = source
      source.on('ready', (info) => send('video:ready', info))
      source.on('status', (text) => send('video:status', { text }))
      source.on('error', (err) => send('video:status', { text: err.message, error: true }))
      source.on('closed', () => send('video:status', { text: 'Stopped', closed: true }))
      source.on('unit', (unit) => {
        // The Uint8Array is copied by the structured clone on the way over,
        // so the depayloader's buffer can be reused freely here.
        send('video:unit', {
          data: unit.data,
          keyframe: unit.keyframe,
          timestamp: unit.timestamp,
        })
      })
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('video:close', () => {
    stop()
    return { ok: true as const }
  })
}

/** Called when the window goes away, so a stream cannot outlive it. */
export function stopVideo() {
  current?.close()
  current = null
}
