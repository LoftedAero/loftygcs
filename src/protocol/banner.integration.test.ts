// @vitest-environment node
//
// Does asking for the banner actually bring the frame line back?
//
// The airframe a vehicle draws as comes from a STATUSTEXT it emits **once**,
// at boot -- so a GCS that attaches later never hears it and cannot know what
// it is looking at. MAV_CMD_DO_SEND_BANNER (42428) is ArduPilot's own command
// for re-sending it, and Mission Planner sends it for the same reason. None of
// that is worth believing without asking a real ArduPilot, which is what this
// does: start SITL (npm run sitl), then SITL=1 npm test.
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
      // The engine fires the request itself on the first heartbeat, so this
      // is the shipping path rather than a bespoke send.
      await waitFor(
        () => events.filter((e) => e.t === 'statustext').length > 0,
        15000,
        'banner statustext',
      )
      const lines = events.flatMap((e) => (e.t === 'statustext' ? [e.text] : []))

      // The banner names the firmware. That much every vehicle does, and it
      // is what proves the command was honored rather than ignored: SITL is
      // long past boot by the time this connects.
      expect(lines.some((l) => /Ardu(Copter|Plane|Rover|Sub)|APM:Copter|ChibiOS/i.test(l))).toBe(
        true,
      )

      // And the part the airframe render depends on. A frame line is not
      // guaranteed for every vehicle, so this asserts the *parse* rather
      // than its presence: if ArduPilot said a frame, `frameName` must find
      // it, because that is the string the store latches.
      const frameLine = lines.find((l) => /\bFrame:/i.test(l))
      if (frameLine) expect(frameName([frameLine])).toBeTruthy()
      // Recorded either way, so a run against a different vehicle says what
      // it saw rather than passing silently.
      console.log(`banner lines: ${JSON.stringify(lines)}`)
    } finally {
      engine.stop()
      socket?.destroy()
    }
  }, 60000)
})
