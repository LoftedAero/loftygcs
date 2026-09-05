// @vitest-environment node
//
// Mission progress against real ArduPilot: upload a plan, fly it, and watch
// the vehicle's own reports of which item it is on and how far away it is.
// Start SITL first (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { ProtocolEngine } from './engine'
import { messageToDeltas } from './telemetry'
import type { MissionItem, ProtocolEvent, TelemetryDelta } from './types'

const SITL_HOST = '127.0.0.1'
const SITL_PORT = 5760

/**
 * A short square near the SITL home at CMAC.
 *
 * Seq 0 is home and carries `current: 1`, which is the shape ArduPilot
 * accepts -- the round-trip test next door found that out the hard way and
 * this mirrors it rather than rediscovering it.
 */
function squareMission(home: MissionItem | undefined): MissionItem[] {
  const wp = (seq: number, lat: number, lon: number, alt: number): MissionItem => ({
    seq,
    frame: 3, // relative to home
    command: 16, // NAV_WAYPOINT
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(lat * 1e7),
    y: Math.round(lon * 1e7),
    z: alt,
  })
  return [
    { ...(home ?? wp(0, -35.363262, 149.165237, 584)), seq: 0, current: 1 },
    { ...wp(1, 0, 0, 30), command: 22 }, // NAV_TAKEOFF
    wp(2, -35.3625, 149.1642, 40),
    wp(3, -35.3618, 149.1655, 40),
    { ...wp(4, 0, 0, 0), command: 20 }, // NAV_RETURN_TO_LAUNCH
  ]
}

describe.runIf(process.env.SITL === '1')('mission progress against SITL', () => {
  it('reports the item being flown and the distance to it', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = net.connect(SITL_PORT, SITL_HOST)
    socket.on('error', () => {})
    await once(socket, 'connect')
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()

    const waitFor = async (what: string, cond: () => boolean, ms: number) => {
      const t0 = Date.now()
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    await waitFor('heartbeat', () => events.some((e) => e.t === 'heartbeat'), 20000)
    // Mission storage is not ready the instant the first heartbeat lands:
    // uploading straight away is refused with NO_SPACE, which reads like a
    // full vehicle and is really an uninitialized one. The neighbouring
    // round-trip test never sees this because it does ten seconds of
    // parameter and motor work first.
    await waitFor(
      'the vehicle to finish booting',
      () => events.some((e) => e.t === 'statustext' && /ready|initialised|EKF/i.test(e.text)),
      30000,
    )
    await new Promise((r) => setTimeout(r, 3000))

    const home = await engine.downloadMission(0).then((m) => m[0])
    await engine.uploadMission(squareMission(home), 0)

    // Guided takeoff, then Auto: a copter on the ground in Auto sits at
    // the first item until the throttle is raised, which is not what this
    // test is about.
    await engine.runCommand(176, [1, 4, 0, 0, 0, 0, 0]) // DO_SET_MODE -> Guided
    await engine.runCommand(400, [1, 0, 0, 0, 0, 0, 0]) // arm
    await engine.runCommand(22, [0, 0, 0, 0, 0, 0, 30]) // takeoff to 30 m

    // Collect what the vehicle says about its progress.
    const progress: TelemetryDelta[] = []
    const collect = setInterval(() => {}, 1000)
    const seen = () =>
      events
        .filter((e) => e.t === 'telemetry')
        .flatMap((e) => (e.t === 'telemetry' ? e.batch : []))
        .filter((d) => d.k === 'missionProgress')
    await waitFor('climb', () => seen().length > 0, 30000)
    await engine.runCommand(176, [1, 3, 0, 0, 0, 0, 0]) // DO_SET_MODE -> Auto
    await waitFor(
      'a waypoint distance',
      () => seen().some((d) => d.k === 'missionProgress' && d.wpDistM !== null),
      45000,
    )
    clearInterval(collect)
    progress.push(...seen())

    const withSeq = progress.filter((d) => d.k === 'missionProgress' && d.seq !== null)
    const withDist = progress.filter((d) => d.k === 'missionProgress' && d.wpDistM !== null)
    engine.stop()
    socket.destroy()

    // Both halves of the fact arrive, from their two separate messages.
    expect(withSeq.length).toBeGreaterThan(0)
    expect(withDist.length).toBeGreaterThan(0)

    // A distance the vehicle actually flies: the square's legs are about
    // 100 m, so anything past a few kilometres means the decode is wrong.
    for (const d of withDist) {
      if (d.k !== 'missionProgress' || d.wpDistM === null) continue
      expect(d.wpDistM).toBeGreaterThanOrEqual(0)
      expect(d.wpDistM).toBeLessThan(5000)
    }
    // And a sequence inside the plan that was just uploaded.
    for (const d of withSeq) {
      if (d.k !== 'missionProgress' || d.seq === null) continue
      expect(d.seq).toBeGreaterThanOrEqual(0)
      expect(d.seq).toBeLessThanOrEqual(5)
    }
  }, 180000)
})

// The normalizer itself, without a vehicle: these two messages are the whole
// input to the feature, so their field names are worth pinning down.
describe('normalizing the two messages', () => {
  it('reads the sequence from MISSION_CURRENT', () => {
    const deltas = messageToDeltas({
      msgid: 42,
      msgName: 'MISSION_CURRENT',
      sysid: 1,
      compid: 1,
      seq: 0,
      fields: { seq: 3 },
    })
    expect(deltas).toEqual([{ k: 'missionProgress', seq: 3, wpDistM: null, altErrorM: null }])
  })

  it('reads the distance from NAV_CONTROLLER_OUTPUT', () => {
    const deltas = messageToDeltas({
      msgid: 62,
      msgName: 'NAV_CONTROLLER_OUTPUT',
      sysid: 1,
      compid: 1,
      seq: 0,
      fields: { wpDist: 120, altError: -2.5 },
    })
    expect(deltas).toEqual([{ k: 'missionProgress', seq: null, wpDistM: 120, altErrorM: -2.5 }])
  })
})
