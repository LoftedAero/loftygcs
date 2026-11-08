// @vitest-environment node
//
// The HUD's second GPS line comes from GPS2_RAW, which ArduPilot sends only
// while GPS2_TYPE is set, and then even with no receiver behind it. Start
// SITL (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import type { ProtocolEvent } from './types'

const MAV_PARAM_TYPE_INT8 = 2

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('a second GPS against SITL', () => {
  it('reports GPS2_RAW only while GPS2_TYPE is set', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((o) => {
      if (o.t === 'tx') socket?.write(o.bytes)
      else if (o.t === 'evt') events.push(o.evt)
    })
    socket = await connectSitl()
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()

    const gps = () => events.flatMap((e) => (e.t === 'telemetry' ? e.batch : []))
    const seen = (k: 'gps' | 'gps2') => gps().some((d) => d.k === k)

    try {
      await waitFor(() => events.some((e) => e.t === 'heartbeat'), 30000, 'a heartbeat')
      // Telemetry is flowing once GPS 1 reports; with one GPS there is no GPS2_RAW.
      await waitFor(() => seen('gps'), 15000, 'GPS_RAW_INT')
      await new Promise((r) => setTimeout(r, 2000))
      expect(seen('gps2')).toBe(false)

      await engine.setParam('GPS2_TYPE', 1, MAV_PARAM_TYPE_INT8)
      try {
        // Read live: no reboot is needed for the message to start.
        await waitFor(() => seen('gps2'), 10000, 'GPS2_RAW')
        const last = gps()
          .filter((d) => d.k === 'gps2')
          .at(-1)!
        console.log(`GPS2_RAW: ${JSON.stringify(last)}`)
        expect(typeof last.fixType).toBe('number')
      } finally {
        await engine.setParam('GPS2_TYPE', 0, MAV_PARAM_TYPE_INT8)
      }
    } finally {
      engine.stop()
      socket.destroy()
    }
  }, 90000)
})
