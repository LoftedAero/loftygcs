// @vitest-environment node
//
// Checks that MAV_CMD_PREFLIGHT_STORAGE with param1 = 2 (Reset to defaults)
// is honored and that nothing else is. A file of its own, because it erases
// the simulator's stored parameters; the runner wipes them again for the next
// connection (-w), which is also why this cannot check the defaults after a
// reboot. Start SITL (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import type { ProtocolEvent } from './types'

const MAV_CMD_PREFLIGHT_STORAGE = 245
const MAV_RESULT_ACCEPTED = 0

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('Reset to defaults', () => {
  it('erases the stored parameters on param1 = 2 and refuses other values', async () => {
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
      // 0 and 1 are read and write in the spec; ArduPilot implements neither,
      // so a wrong param1 cannot erase anything by accident.
      expect(await engine.runCommand(MAV_CMD_PREFLIGHT_STORAGE, [1, 0, 0, 0, 0, 0, 0])).not.toBe(
        MAV_RESULT_ACCEPTED,
      )

      expect(await engine.runCommand(MAV_CMD_PREFLIGHT_STORAGE, [2, 0, 0, 0, 0, 0, 0])).toBe(
        MAV_RESULT_ACCEPTED,
      )
      // The firmware's own confirmation that AP_Param::erase_all ran.
      await waitFor(
        () => events.some((e) => e.t === 'statustext' && /All parameters reset/i.test(e.text)),
        5000,
        'the reset message',
      )
    } finally {
      engine.stop()
      socket?.destroy()
    }
  })
})
