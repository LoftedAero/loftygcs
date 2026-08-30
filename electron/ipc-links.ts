import { ipcMain, type BrowserWindow } from 'electron'
import net from 'node:net'
import dgram from 'node:dgram'

// TCP/UDP link sockets for the renderer's network transports. Browsers
// cannot open raw sockets, so these exist only in the Electron build; the
// renderer reaches them through window.loftgcs.link (see preload.ts).
//
// Each open link gets a numeric id. The renderer's TransportManager keeps
// only one transport active, but ids still matter: a close racing an open
// must not let the old socket's late data masquerade as the new link's.

interface Link {
  kind: 'tcp' | 'udp'
  close: () => void
  write: (data: Uint8Array) => void
}

const links = new Map<number, Link>()
let nextId = 1

export function registerLinkIpc(getWindow: () => BrowserWindow | null) {
  const send = (channel: string, ...args: unknown[]) => {
    getWindow()?.webContents.send(channel, ...args)
  }

  ipcMain.handle(
    'link:open',
    (_e, opts: { kind: 'tcp' | 'udp'; host?: string; port: number; localPort?: number }) => {
      const id = nextId++
      if (opts.kind === 'tcp') {
        const socket = new net.Socket()
        socket.on('data', (data) => send('link:data', id, new Uint8Array(data)))
        socket.on('error', (err) => send('link:close', id, err.message))
        socket.on('close', () => {
          if (links.delete(id)) send('link:close', id)
        })
        links.set(id, {
          kind: 'tcp',
          write: (data) => socket.write(data),
          close: () => socket.destroy(),
        })
        return new Promise<number>((resolve, reject) => {
          socket.once('error', reject)
          socket.connect(opts.port, opts.host ?? '127.0.0.1', () => resolve(id))
        })
      }

      // UDP: bind locally and, until a remote is known, learn it from the
      // first packet -- SITL and telemetry bridges both start by sending.
      const socket = dgram.createSocket('udp4')
      let remote: { address: string; port: number } | null = opts.host
        ? { address: opts.host, port: opts.port }
        : null
      socket.on('message', (data, rinfo) => {
        if (!remote) remote = { address: rinfo.address, port: rinfo.port }
        send('link:data', id, new Uint8Array(data))
      })
      socket.on('error', (err) => send('link:close', id, err.message))
      links.set(id, {
        kind: 'udp',
        write: (data) => {
          if (remote) socket.send(data, remote.port, remote.address)
        },
        close: () => socket.close(),
      })
      return new Promise<number>((resolve, reject) => {
        socket.once('error', reject)
        socket.bind(opts.localPort ?? opts.port, () => resolve(id))
      })
    },
  )

  ipcMain.on('link:write', (_e, id: number, data: Uint8Array) => {
    links.get(id)?.write(data)
  })

  ipcMain.handle('link:close', (_e, id: number) => {
    const link = links.get(id)
    links.delete(id)
    link?.close()
  })
}
