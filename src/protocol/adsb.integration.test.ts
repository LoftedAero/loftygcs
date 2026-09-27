// @vitest-environment node
//
// ADS-B against SITL, which can generate its own traffic.
//
// SITL's SIM_ADSB flies a few aircraft around the vehicle and reports them
// through the same ADSB_VEHICLE path a real receiver uses, so the whole chain
// (firmware, wire format, decode, validity flags) can be tested here.
//
// It needs SITL launched with `npm run sitl -- --adsb` and skips otherwise.
// Setting the parameters over MAVLink is not enough: ADSB_TYPE starts its
// backend live, but the simulated receiver is a `--serial5 sim:adsb` device
// and the serial protocol for it is read only at boot.
//
// This checks what a fake cannot: the decoded field names (ADSB_VEHICLE's
// `ICAOAddress` is not camelCase, and a wrong key reads as undefined), and
// which validity flags ArduPilot actually sets.
//
//   npm run sitl
//   SITL=1 npm test
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import type { AdsbTarget } from './adsb'
import type { ProtocolEvent } from './types'

/** What `--adsb` asks the simulator for, and so the most that can arrive. */
const TRAFFIC = 4

describe.runIf(process.env.SITL === '1')('ADS-B against SITL', () => {
  it(
    'hears simulated aircraft and decodes what the firmware vouches for',
    async () => {
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectSitl()
      socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
      engine.start()

      const waitFor = async (what: string, cond: () => boolean, ms: number) => {
        const deadline = Date.now() + ms
        while (!cond()) {
          if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
          await new Promise((r) => setTimeout(r, 200))
        }
      }

      try {
        await waitFor('a heartbeat', () => events.some((e) => e.t === 'heartbeat'), 30000)

        // Launched without --adsb: warn and skip.
        const params = await engine.downloadParams()
        const configured = params.params.find((p) => p.name === 'ADSB_TYPE')?.value
        if (!configured) {
          console.warn('SITL has no ADS-B receiver; run `npm run sitl -- --adsb` for this one')
          return
        }
        expect(params.params.find((p) => p.name === 'SIM_ADSB_COUNT')?.value).toBeGreaterThan(0)

        // Wait for more than one: aircraft come into range one at a time, and
        // a single target proves nothing about keeping two apart.
        await waitFor(
          'more than one aircraft',
          () => events.some((e) => e.t === 'traffic' && e.targets.length > 1),
          90000,
        )
        // The fullest picture, not the latest: aircraft also leave range.
        const pictures = events.filter((e) => e.t === 'traffic')
        const fullest = pictures.reduce((best, e) =>
          e.t === 'traffic' && best.t === 'traffic' && e.targets.length > best.targets.length
            ? e
            : best,
        )
        if (fullest.t !== 'traffic') throw new Error('unreachable')
        const targets: AdsbTarget[] = fullest.targets

        // Distinct addresses: a mis-read ICAO key collapses them into one.
        const addresses = new Set(targets.map((t) => t.icao))
        expect(addresses.size).toBe(targets.length)
        expect(targets.length).toBeGreaterThan(1)
        expect(targets.length).toBeLessThanOrEqual(TRAFFIC)
        for (const t of targets) expect(t.icao).toBeGreaterThan(0)

        // A report without a valid position is dropped, so every target has one.
        for (const t of targets) {
          expect(Math.abs(t.latDeg)).toBeGreaterThan(0)
          expect(Math.abs(t.latDeg)).toBeLessThanOrEqual(90)
          expect(Math.abs(t.lonDeg)).toBeLessThanOrEqual(180)
        }

        // Loose bounds that check the scales (millimeters for altitude, cm/s
        // for velocity, centidegrees for heading): a factor-of-ten error in
        // any of them lands well outside.
        const withAlt = targets.filter((t) => t.altMslM !== null)
        expect(withAlt.length).toBeGreaterThan(0)
        for (const t of withAlt) expect(t.altMslM!).toBeGreaterThan(-500)
        for (const t of withAlt) expect(t.altMslM!).toBeLessThan(20000)

        for (const t of targets) {
          if (t.headingDeg !== null) {
            expect(t.headingDeg).toBeGreaterThanOrEqual(0)
            expect(t.headingDeg).toBeLessThan(360)
          }
          // Faster than any airliner means a unit error.
          if (t.groundSpeedMs !== null) expect(t.groundSpeedMs).toBeLessThan(400)
        }

        // ArduPilot flags its simulated traffic, and the app shows it.
        expect(targets.some((t) => t.simulated)).toBe(true)

        // The picture is a snapshot sent about once a second, not one event
        // per report.
        expect(pictures.length).toBeGreaterThan(0)
        expect(pictures.length).toBeLessThan(events.filter((e) => e.t === 'telemetry').length)
      } finally {
        // Nothing to restore: the configuration came from the launch.
        engine.stop()
        socket.destroy()
      }
    },
    180000,
  )
})
