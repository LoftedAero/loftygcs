// The Android app's byte links (android/.../LinkPlugin.java), shaped like the
// desktop bridge's `window.loftgcs.link` so one transport serves both. Bytes
// cross the Capacitor bridge as base64, since it carries JSON only.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type LinkOpen =
  | { kind: 'tcp'; host?: string; port: number }
  | { kind: 'udp'; host?: string; port: number; localPort?: number }
  | { kind: 'uart'; path: string; baudRate: number }

/** The desktop bridge's `link` surface, widened with the UART kind. */
export interface LinkApi {
  open(opts: LinkOpen): Promise<number>
  write(id: number, data: Uint8Array): void
  close(id: number): Promise<void>
  onData(cb: (id: number, data: Uint8Array) => void): () => void
  onClose(cb: (id: number, error?: string) => void): () => void
}

interface LinkPlugin {
  open(opts: LinkOpen): Promise<{ id: number }>
  write(opts: { id: number; data: string }): Promise<void>
  close(opts: { id: number }): Promise<void>
  addListener(
    event: 'data',
    cb: (e: { id: number; data: string }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'close',
    cb: (e: { id: number; error?: string }) => void,
  ): Promise<PluginListenerHandle>
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

let api: LinkApi | null = null

/** The native links, or null outside the Android app. */
export function nativeLink(): LinkApi | null {
  if (!Capacitor.isNativePlatform()) return null
  if (api) return api

  const plugin = registerPlugin<LinkPlugin>('Link')
  const dataCbs = new Set<(id: number, data: Uint8Array) => void>()
  const closeCbs = new Set<(id: number, error?: string) => void>()
  // One native subscription each, fanned out here, so the bridge's
  // synchronous unsubscribe can be kept.
  void plugin.addListener('data', (e) => {
    const bytes = fromBase64(e.data)
    for (const cb of dataCbs) cb(e.id, bytes)
  })
  void plugin.addListener('close', (e) => {
    for (const cb of closeCbs) cb(e.id, e.error)
  })

  api = {
    open: async (opts) => (await plugin.open(opts)).id,
    write: (id, data) => void plugin.write({ id, data: toBase64(data) }),
    close: (id) => plugin.close({ id }),
    onData: (cb) => {
      dataCbs.add(cb)
      return () => dataCbs.delete(cb)
    },
    onClose: (cb) => {
      closeCbs.add(cb)
      return () => closeCbs.delete(cb)
    },
  }
  return api
}
