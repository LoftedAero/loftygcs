// @vitest-environment node
//
// Shared SITL connection for the integration tests.
//
// SITL accepts a single TCP client and exits when it disconnects, so
// `scripts/sitl.mjs` relaunches it after every test file. Connecting before
// the new process binds the port gets ECONNREFUSED, so connections retry.
//
// Kept out of src/protocol, which must stay environment-agnostic.

import net from 'node:net'
import { once } from 'node:events'

export const SITL_HOST = '127.0.0.1'
/** Set SITL_PORT to reach a second simulator started with `-I1` (5770). */
export const SITL_PORT = Number(process.env.SITL_PORT) || 5760

/**
 * Opens a socket to SITL, retrying through a relaunch. A relaunch usually
 * takes about a second; the generous timeout covers a loaded machine.
 */
export async function connectSitl(timeoutMs = 30000): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const socket = net.connect(SITL_PORT, SITL_HOST)
      await once(socket, 'connect')
      // Teardown races SITL's own shutdown; an unhandled reset would fail
      // an otherwise green run.
      socket.on('error', () => {})
      return socket
    } catch {
      if (Date.now() > deadline) throw new Error(`could not reach SITL on TCP ${SITL_PORT}`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}
