// @vitest-environment node
//
// The Preflight pane's arming checks against a live vehicle. Start SITL
// (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import { checkForReason } from './arming-checks'
import { isPrearmMessage } from './prearm'
import type { ProtocolEvent } from './types'

const MAV_CMD_RUN_PREARM_CHECKS = 401
const MAV_PARAM_TYPE_REAL32 = 9

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('arming checks against SITL', () => {
  it('accepts a checks run, and words a failure the matcher places', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((o) => {
      if (o.t === 'tx') socket?.write(o.bytes)
      else if (o.t === 'evt') events.push(o.evt)
    })
    socket = await connectSitl()
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()

    const texts = () =>
      events.filter((e) => e.t === 'statustext').map((e) => (e as { text: string }).text)

    try {
      await waitFor(() => events.some((e) => e.t === 'heartbeat'), 30000, 'a heartbeat')

      // The pane asks for a checks run; ArduPilot must accept it.
      expect(await engine.runCommand(MAV_CMD_RUN_PREARM_CHECKS, [0, 0, 0, 0, 0, 0, 0])).toBe(0)

      // A real Battery Level failure, worded by the firmware, lands on its check.
      const before = texts().length
      await engine.setParam('BATT_ARM_VOLT', 20, MAV_PARAM_TYPE_REAL32)
      const battery = () =>
        texts()
          .slice(before)
          .find((t) => isPrearmMessage(t) && /Battery/.test(t))
      try {
        // A vehicle still starting up answers with "System not initialised"
        // alone, so the run is asked for again until the reason arrives.
        const t0 = Date.now()
        while (!battery()) {
          if (Date.now() - t0 > 60000) throw new Error('timed out waiting for a battery reason')
          await engine.runCommand(MAV_CMD_RUN_PREARM_CHECKS, [0, 0, 0, 0, 0, 0, 0])
          await new Promise((r) => setTimeout(r, 2000))
        }
        const reason = battery()!.replace(/^(PreArm|Arm)\s*:\s*/i, '')
        expect(checkForReason(reason)).toBe(8)
      } finally {
        await engine.setParam('BATT_ARM_VOLT', 0, MAV_PARAM_TYPE_REAL32)
      }
    } finally {
      engine.stop()
      socket.destroy()
    }
  }, 120000)
})
