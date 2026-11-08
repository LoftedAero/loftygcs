// @vitest-environment node
//
// Parameters, missions and logs over a slow radio link: SITL behind the SlowLink
// shim, which approximates ELRS in MAVLink mode at 333 Hz. Start SITL first
// (npm run sitl, or npm run sitl -- plane), then:
//   SITL=1 npx vitest run slow-link
// Skipped otherwise. Run it against Copter and Plane.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { SlowLink } from '../test-fixtures/slow-link'
import { ProtocolEngine } from './engine'
import { parseDataflash } from './dataflash'
import type { MissionItem, ProtocolEvent } from './types'

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** A lawnmower of waypoints around SITL's default home. */
function survey(count: number): MissionItem[] {
  const home = { lat: -35.363262, lon: 149.165237 }
  const items: MissionItem[] = []
  for (let seq = 0; seq < count; seq++) {
    const lane = Math.floor(seq / 2)
    const north = seq % 2 === 0 ? 0 : 0.003
    items.push({
      seq,
      frame: seq === 0 ? 0 : 3,
      command: 16, // NAV_WAYPOINT; seq 0 is home
      current: 0,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: Math.round((home.lat + north) * 1e7),
      y: Math.round((home.lon + lane * 0.0004) * 1e7),
      z: seq === 0 ? 0 : 50 + seq,
    })
  }
  return items
}

describe.runIf(process.env.SITL === '1')('slow link', () => {
  it('downloads parameters, writes one, round-trips a mission and reads a log', async () => {
    const events: ProtocolEvent[] = []
    /** Arrival time of each event, for the timing breakdown. */
    const times: number[] = []
    let socket: net.Socket | null = null
    let link: SlowLink | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') link?.fromGcs(out.bytes)
      else if (out.t === 'evt') {
        events.push(out.evt)
        times.push(Date.now())
      }
    })
    socket = await connectSitl()
    socket.on('error', () => {})
    link = new SlowLink(
      (b) => engine.pushBytes(b),
      (b) => socket?.write(b),
    )
    socket.on('data', (d) => link?.fromVehicle(new Uint8Array(d)))
    link.start()
    engine.start()

    try {
      await waitFor(() => events.some((e) => e.t === 'heartbeat'), 30000, 'first heartbeat')
      await waitFor(
        () => events.some((e) => e.t === 'telemetry' && e.batch.some((d) => d.k === 'attitude')),
        30000,
        'attitude over the slow link',
      )

      const t0 = Date.now()
      const seenBefore = events.length
      const result = await engine.downloadParams()
      const paramSecs = (Date.now() - t0) / 1000
      // Where the time went: MAVFTP's attempt, the stream, then the gaps.
      const phase = (source: 'ftp' | 'stream') => {
        const at = events
          .map((e, i) => ({ e, at: times[i]! }))
          .slice(seenBefore)
          .filter(({ e }) => e.t === 'paramProgress' && e.source === source)
        return at.length ? [(at[0]!.at - t0) / 1000, (at.at(-1)!.at - t0) / 1000, at.length] : null
      }
      console.log('params ftp [start s, end s, events]', phase('ftp'), 'stream', phase('stream'))
      expect(result.params.length).toBeGreaterThan(500)
      expect(result.params.find((p) => p.name === 'FORMAT_VERSION')).toBeDefined()

      const loit = result.params.find((p) =>
        ['LOIT_SPEED_MS', 'LOIT_SPEED', 'WP_LOITER_RAD'].includes(p.name),
      )!
      expect(await engine.setParam(loit.name, loit.value + 1, loit.mavType)).toBeCloseTo(
        loit.value + 1,
        3,
      )
      expect(await engine.setParam(loit.name, loit.value, loit.mavType)).toBeCloseTo(loit.value, 3)

      const items = survey(40)
      const t1 = Date.now()
      await engine.uploadMission(items, 0)
      const back = await engine.downloadMission(0)
      const missionSecs = (Date.now() - t1) / 1000
      expect(back).toHaveLength(items.length)
      for (let i = 1; i < items.length; i++) {
        expect(back[i]!.x).toBe(items[i]!.x)
        expect(back[i]!.y).toBe(items[i]!.y)
        expect(back[i]!.z).toBeCloseTo(items[i]!.z, 3)
      }
      await engine.clearMission(0)

      // Logs over the log protocol, which boards logging to onboard flash
      // need. Lost LOG_DATA is asked for again once the stream has ended. A
      // whole log takes minutes at this rate, so only its start is read; a
      // hole filled with anything but the log would break the framing.
      const t2 = Date.now()
      const entries = await engine.listLogs()
      expect(entries.length).toBeGreaterThan(0)
      const listSecs = (Date.now() - t2) / 1000

      const BYTES = 20000
      const log = entries.find((e) => e.size >= BYTES)!
      const t3 = Date.now()
      const bytes = await engine.downloadLog(log.id, BYTES)
      const readSecs = (Date.now() - t3) / 1000
      expect(bytes.length).toBe(BYTES)
      const parsed = parseDataflash(bytes)
      expect(parsed.messages.has('PARM')).toBe(true)
      expect(parsed.skippedBytes).toBe(0)

      console.log(
        `slow link: ${result.params.length} params via ${result.source} in ${paramSecs.toFixed(1)} s; ` +
          `40-item mission up and back in ${missionSecs.toFixed(1)} s; ` +
          `${entries.length} logs listed in ${listSecs.toFixed(1)} s and ` +
          `${BYTES} bytes of one read in ${readSecs.toFixed(1)} s; ` +
          `lost packets ${link.stats.lostPackets}`,
      )
    } finally {
      engine.stop()
      link.stop()
      socket.destroy()
    }
  }, 420000)
})
