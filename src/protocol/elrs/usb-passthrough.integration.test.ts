// @vitest-environment node
//
// The receiver sequence's MAVLink half against ArduPilot itself: the
// parameter names it reads and writes exist on the vehicle, a relay set up
// on a pin answers DO_SET_RELAY, an interrupted write is recognized from the
// vehicle's own parameters, and the restore leaves the relays cleared.
//
// No reboot and no passthrough: the runner relaunches SITL with -w, which
// wipes what a reboot would keep, and SITL's serial ports are not the
// board's. Both are proven on the board itself. Start SITL (npm run sitl,
// for Copter and for Plane), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../../test-fixtures/sitl-client'
import { ProtocolEngine } from '../engine'
import type { ProtocolEvent } from '../types'
import type { ReceiverWiring } from '../lofted-boards'
import {
  interruptedRun,
  restoreReceiver,
  savedParamNames,
  setupParams,
  type PassthroughLink,
  type SavedState,
} from './usb-passthrough'

const MAV_CMD_DO_SET_RELAY = 181
const MAV_RESULT_ACCEPTED = 0
const REAL32 = 9

const wiring: ReceiverWiring = {
  target: 'newbeedrone.rx_2400.c324d',
  serial: 2,
  bootPin: 71,
  enPin: 70,
  baud: 420000,
}

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('ELRS receiver write settings', () => {
  it('configures the relays, sees the interrupted write, and restores it', async () => {
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
      const known = new Map((await engine.downloadParams()).params.map((p) => [p.name, p.value]))
      const read = async (name: string) => (await engine.readParam(name)).value
      // A relay's PIN and DEFAULT are left out of the parameter list while its
      // FUNCTION is 0, but answer a read by name, which is what step 1 uses.
      for (const name of savedParamNames(wiring)) {
        await expect(read(name), name).resolves.toBeTypeOf('number')
      }
      const original = await read('SERIAL_PASSTIMO')

      // The write's setup, as step 2 sends it.
      for (const [name, value] of Object.entries(setupParams(wiring, 28))) {
        expect(await engine.setParam(name, value, REAL32), name).toBe(value)
        known.set(name, value)
      }
      expect(interruptedRun(known, wiring, new Set([28]))).toBe(true)

      // A relay configured on a pin answers; RELAY1 is instance 0.
      expect(await engine.runCommand(MAV_CMD_DO_SET_RELAY, [0, 0, 0, 0, 0, 0, 0])).toBe(
        MAV_RESULT_ACCEPTED,
      )
      expect(await engine.runCommand(MAV_CMD_DO_SET_RELAY, [0, 1, 0, 0, 0, 0, 0])).toBe(
        MAV_RESULT_ACCEPTED,
      )

      let saved: Record<string, number> | null = { SERIAL_PASSTIMO: original }
      const state: SavedState = {
        load: () => saved,
        save: (v) => (saved = v),
        clear: () => (saved = null),
      }
      const link: PassthroughLink = {
        armed: () => false,
        readParam: read,
        knownParams: () => known,
        writeParam: (name, value) => engine.setParam(name, value, REAL32),
        setRelay: (instance, high) =>
          engine
            .runCommand(MAV_CMD_DO_SET_RELAY, [instance, high ? 1 : 0, 0, 0, 0, 0, 0])
            .catch(() => -1),
        // See the header: a SITL reboot would wipe what is being checked.
        reboot: async () => {},
        closeLink: async () => {},
        openLink: async () => true,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      }
      await restoreReceiver({ link, wiring, passthroughProtocol: 28, state })

      expect(await read(`SERIAL${wiring.serial}_PROTOCOL`)).toBe(23)
      expect(await read('RELAY1_FUNCTION')).toBe(0)
      expect(await read('RELAY1_PIN')).toBe(-1)
      expect(await read('RELAY2_FUNCTION')).toBe(0)
      expect(await read('RELAY2_PIN')).toBe(-1)
      expect(await read('SERIAL_PASSTIMO')).toBe(original)
      expect(saved).toBeNull()
      const after = new Map(known)
      for (const n of ['RELAY1_PIN', 'RELAY2_PIN']) after.set(n, -1)
      after.set('SERIAL2_PROTOCOL', 23)
      expect(interruptedRun(after, wiring, new Set([28]))).toBe(false)
    } finally {
      engine.stop()
      socket?.destroy()
    }
  }, 60000)
})
