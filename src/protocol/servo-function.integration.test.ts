// @vitest-environment node
//
// ArduPilot's metadata marks SERVOn_FUNCTION RebootRequired, but the vehicle
// re-reads the functions every second, which is why the app prompts only for
// the changes `servo-function.ts` lists. Start SITL (npm run sitl), then
// SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import { ignoreValue, RELEASE } from './joystick'
import { servoFunctionAppliesLive } from './servo-function'
import type { ProtocolEvent } from './types'

const MAV_PARAM_TYPE_INT16 = 4
const RCIN1 = 51
const HELD = 1234

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('output functions against SITL', () => {
  it('moves an output to a new function without a reboot', async () => {
    expect(servoFunctionAppliesLive(0, RCIN1)).toBe(true)

    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((o) => {
      if (o.t === 'tx') socket?.write(o.bytes)
      else if (o.t === 'evt') events.push(o.evt)
    })
    socket = await connectSitl()
    socket.on('error', () => {})
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()

    const servo9 = (): number | undefined => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.t !== 'telemetry') continue
        for (let j = e.batch.length - 1; j >= 0; j--) {
          const d = e.batch[j]!
          if (d.k === 'servoOutputs' && d.port === 0) return d.valuesUs[8]
        }
      }
      return undefined
    }
    const override = (ch1: number) => {
      const fields: Record<string, number> = { targetSystem: 1, targetComponent: 1 }
      for (let i = 1; i <= 18; i++) fields[`chan${i}Raw`] = i === 1 ? ch1 : ignoreValue(i)
      engine.send('RC_CHANNELS_OVERRIDE', fields)
    }
    const hold = setInterval(() => override(HELD), 100)

    try {
      await waitFor(() => events.some((e) => e.t === 'heartbeat'), 30000, 'a heartbeat')
      await waitFor(() => servo9() !== undefined, 15000, 'SERVO_OUTPUT_RAW')
      await new Promise((r) => setTimeout(r, 1500))
      expect(servo9()).not.toBe(HELD)

      await engine.setParam('SERVO9_FUNCTION', RCIN1, MAV_PARAM_TYPE_INT16)
      try {
        // Within the vehicle's once-a-second pass over the functions.
        await waitFor(() => servo9() === HELD, 5000, 'output 9 to pass RC input 1 through')
      } finally {
        await engine.setParam('SERVO9_FUNCTION', 0, MAV_PARAM_TYPE_INT16)
      }
    } finally {
      clearInterval(hold)
      for (let i = 0; i < 3; i++) {
        const fields: Record<string, number> = { targetSystem: 1, targetComponent: 1 }
        RELEASE.forEach((v, i) => (fields[`chan${i + 1}Raw`] = v))
        engine.send('RC_CHANNELS_OVERRIDE', fields)
      }
      await new Promise((r) => setTimeout(r, 200))
      engine.stop()
      socket.destroy()
    }
  }, 90000)
})
