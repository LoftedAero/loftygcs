// @vitest-environment node
//
// The distiller against ArduPilot's own words. The strings in prearm.test.ts
// were taken from AP_Arming; this proves a live vehicle says things of that
// shape and that they survive the round trip. Start SITL (npm run sitl),
// then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { ProtocolEngine } from './engine'
import { isPrearmMessage, prearmFailures } from './prearm'
import type { ProtocolEvent } from './types'

describe.runIf(process.env.SITL === '1')('prearm reasons from SITL', () => {
  it('captures and distils a real arming refusal', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((o) => {
      if (o.t === 'tx') socket?.write(o.bytes)
      else if (o.t === 'evt') events.push(o.evt)
    })
    socket = net.connect(5760, '127.0.0.1')
    socket.on('error', () => {})
    await once(socket, 'connect')
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()
    await new Promise((r) => setTimeout(r, 3000))

    // Arming before the EKF has settled: ArduPilot refuses and says why.
    await engine.runCommand(400, [1, 0, 0, 0, 0, 0, 0]).catch(() => undefined)
    await new Promise((r) => setTimeout(r, 6000))

    const now = Date.now()
    const texts = events
      .filter((e) => e.t === 'statustext')
      .map((e) => ({ text: (e as { text: string }).text, at: now }))
    engine.stop()
    socket.destroy()

    const recognized = texts.filter((t) => isPrearmMessage(t.text))
    expect(recognized.length).toBeGreaterThan(0)

    const failures = prearmFailures(texts, now)
    expect(failures.length).toBeGreaterThan(0)
    for (const f of failures) {
      // The prefix goes, the reason stays, and nothing is left empty.
      expect(f.reason).not.toMatch(/^(PreArm|Arm)\s*:/i)
      expect(f.reason.length).toBeGreaterThan(0)
    }
    // Ordinary chatter is not mistaken for a reason.
    expect(failures.some((f) => /EKF3 IMU\d initialised/.test(f.reason))).toBe(false)
  }, 60000)
})
