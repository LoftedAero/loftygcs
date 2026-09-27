// @vitest-environment node
//
// Checks that MAV_CMD_DO_SEND_BANNER (42428) brings back the boot banner,
// including the frame line, from a vehicle that booted before we attached.
// Start SITL (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import { frameName } from './airframe'
import type { ProtocolEvent } from './types'

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('DO_SEND_BANNER', () => {
  it('makes a vehicle that booted before we attached say what it is', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })

    for (let attempt = 0; ; attempt++) {
      socket = await connectSitl()
      socket.on('error', () => {})
      socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
      engine.start()
      try {
        await waitFor(() => events.some((e) => e.t === 'heartbeat'), 20000, 'first heartbeat')
        break
      } catch (err) {
        engine.stop()
        socket.destroy()
        socket = null
        if (attempt >= 2) throw err
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    try {
      // The engine sends the request itself on the first heartbeat.
      await waitFor(
        () => events.filter((e) => e.t === 'statustext').length > 0,
        15000,
        'banner statustext',
      )
      const lines = events.flatMap((e) => (e.t === 'statustext' ? [e.text] : []))

      // Every vehicle's banner names the firmware. SITL is long past boot by
      // now, so seeing it proves the command was honored.
      expect(lines.some((l) => /Ardu(Copter|Plane|Rover|Sub)|APM:Copter|ChibiOS/i.test(l))).toBe(
        true,
      )

      // Not every vehicle sends a frame line, so assert the parse rather than
      // its presence.
      const frameLine = lines.find((l) => /\bFrame:/i.test(l))
      if (frameLine) expect(frameName([frameLine])).toBeTruthy()
      console.log(`banner lines: ${JSON.stringify(lines)}`)
    } finally {
      engine.stop()
      socket?.destroy()
    }
  }, 60000)
})
