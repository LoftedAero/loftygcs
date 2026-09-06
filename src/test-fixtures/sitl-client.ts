// @vitest-environment node
//
// Connecting to SITL, for the integration tests that need to.
//
// It exists because every one of them had its own `net.connect` and only
// one of them retried. SITL accepts a single TCP client and exits when that
// client leaves, so `scripts/sitl.mjs` relaunches it after every test file
// -- and a file that connects the instant the previous one finished lands
// in the second or two before the new process has bound the port. The error
// is `ECONNREFUSED`, which reads as "no simulator running" when in fact one
// is starting; the failure is a race, not a result, and it made two files
// fail on a run where the vehicle was perfectly healthy.
//
// Lives in test-fixtures rather than beside the tests in src/protocol: it
// opens sockets, and protocol/ is the one directory that must stay
// environment-agnostic.

import net from 'node:net'
import { once } from 'node:events'

export const SITL_HOST = '127.0.0.1'
export const SITL_PORT = 5760

/**
 * A socket to SITL, waiting out a relaunch.
 *
 * Retried for thirty seconds because that covers the runner noticing the
 * disconnect, spawning a fresh simulator, and it binding the port -- about
 * a second in practice, and longer on a loaded machine which is exactly
 * when this would otherwise flake.
 */
export async function connectSitl(timeoutMs = 30000): Promise<net.Socket> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const socket = net.connect(SITL_PORT, SITL_HOST)
      await once(socket, 'connect')
      // Tearing a test down races SITL's own shutdown, and the reset then
      // arrives as an unhandled exception -- which made a fully green run
      // exit non-zero, defeating the gate the run exists to be.
      socket.on('error', () => {})
      return socket
    } catch {
      if (Date.now() > deadline) throw new Error('could not reach SITL on TCP 5760')
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}
