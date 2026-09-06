// @vitest-environment node
//
// Every command this app offers, uploaded to real ArduPilot one at a time.
//
// The catalog is hand-written data, and two of its entries were wrong in
// ways nothing else could catch: DO_GRIPPER was listed as 212, which is
// DO_AUTOTUNE_ENABLE, so choosing "Gripper" would have started a tuning
// run; and CONDITION_CHANGE_ALT is refused by both Copter and Plane, so it
// was a menu entry that could only ever fail on upload. Neither is visible
// in a type, a unit test, or a review -- the firmware is the only thing
// that knows.
//
// Run against whichever vehicle SITL is serving:
//   npm run sitl           (or: npm run sitl -- plane)
//   SITL=1 npm test
import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { ProtocolEngine } from './engine'
import { MISSION_COMMANDS } from './mission-commands'
import type { MissionItem, ProtocolEvent } from './types'

const run = process.env.SITL === '1' ? describe : describe.skip

/** Copter flies splines; Plane refuses the command outright. */
const COPTER_ONLY = new Set([82, 94])
/** MAV_TYPE values that are copters, from the heartbeat. */
const COPTER_TYPES = new Set([2, 13, 14, 15, 3])

const CMAC = { x: -353632621, y: 1491652374 }

function itemFor(seq: number, command: number): MissionItem {
  const spec = MISSION_COMMANDS.find((c) => c.id === command)
  const base: MissionItem = {
    seq,
    frame: spec?.altitude ? 3 : 0,
    command,
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: spec?.location === false ? 0 : CMAC.x,
    y: spec?.location === false ? 0 : CMAC.y,
    z: spec?.altitude ? 50 : 0,
  }
  // A jump to item 0 is rejected as invalid rather than unsupported, which
  // would look like a catalog error and is not one.
  if (command === 177) return { ...base, param1: 1, param2: 1 }
  return base
}

run('the mission command catalog', () => {
  it(
    'offers only commands this vehicle accepts',
    async () => {
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      const sock = net.connect(5760, '127.0.0.1')
      await once(sock, 'connect')
      sock.on('error', () => {})
      socket = sock
      sock.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
      engine.start()

      const waitFor = async (what: string, cond: () => boolean, ms: number) => {
        const deadline = Date.now() + ms
        while (!cond()) {
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
          await new Promise((r) => setTimeout(r, 100))
        }
      }
      await waitFor('a heartbeat', () => events.some((e) => e.t === 'heartbeat'), 30000)
      // Mission storage is not ready at the first heartbeat: every upload
      // before it is answered "No space on vehicle", which reads exactly
      // like a rejected command and is not one.
      await waitFor(
        'the vehicle to finish booting',
        () => events.some((e) => e.t === 'statustext' && /ready|initialised|EKF/i.test(e.text)),
        30000,
      )
      await new Promise((r) => setTimeout(r, 3000))
      const hb = events.find((e) => e.t === 'heartbeat')
      const isCopter = hb?.t === 'heartbeat' && COPTER_TYPES.has(hb.vehicleType)

      const refused: string[] = []
      try {
        for (const spec of MISSION_COMMANDS) {
          if (!isCopter && COPTER_ONLY.has(spec.id)) continue
          try {
            await engine.uploadMission([itemFor(0, 16), itemFor(1, spec.id)], 0)
          } catch (err) {
            refused.push(
              `${spec.mavName} (${spec.id}): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } finally {
        await engine.clearMission(0).catch(() => {})
        engine.stop()
        sock.destroy()
      }

      expect(refused, `${isCopter ? 'Copter' : 'Plane'} refused:\n${refused.join('\n')}`).toEqual(
        [],
      )
    },
    240000,
  )
})
