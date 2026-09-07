// @vitest-environment node
//
// ADS-B against real ArduPilot, which can generate its own traffic.
//
// SITL builds in SIM_ADSB: the simulator flies a handful of aircraft around
// the vehicle and reports them exactly as a real receiver would, through the
// same ADSB_VEHICLE path. That makes this one of the few features whose whole
// chain -- firmware, wire format, decode, the flags that say which fields are
// real -- can be proved without the hardware, which is the point of the SITL
// discipline here.
//
// It needs the vehicle launched for it -- `npm run sitl -- --adsb` -- and
// skips itself otherwise rather than failing. Setting the parameters over
// MAVLink is not enough and that was measured, not assumed: ADSB_TYPE does
// instantiate its backend live (its parameters appear without a reboot), but
// two of the three things needed are read only at startup. The simulated
// transponder receiver is a `--serial5 sim:adsb` device, and the serial
// protocol that talks to it is read once at boot. A probe that set all three
// over the link saw exactly zero aircraft.
//
// What a fake cannot check, and this does: the field names the decoder
// produces (ADSB_VEHICLE has `ICAOAddress`, where every neighbour is
// camelCase, and a wrong key reads as undefined rather than failing), and
// which flags ArduPilot actually sets -- our reader treats every optional
// field as absent unless its bit is present, so a firmware that sets fewer
// bits than expected shows up here as nulls rather than as wrong numbers on
// a screen.
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

        // Launched without --adsb: say so and stop, rather than fail. The
        // vehicle is healthy and this is simply not the run for it.
        const params = await engine.downloadParams()
        const configured = params.params.find((p) => p.name === 'ADSB_TYPE')?.value
        if (!configured) {
          console.warn('SITL has no ADS-B receiver; run `npm run sitl -- --adsb` for this one')
          return
        }
        expect(params.params.find((p) => p.name === 'SIM_ADSB_COUNT')?.value).toBeGreaterThan(0)

        // More than one, because the simulator's aircraft come into range one
        // at a time and the first picture holds a single target -- which
        // would pass a "some traffic" check while proving nothing about
        // whether two aircraft stay two.
        await waitFor(
          'more than one aircraft',
          () => events.some((e) => e.t === 'traffic' && e.targets.length > 1),
          90000,
        )
        // The fullest picture seen, not the latest: aircraft leave range as
        // well as enter it, and the last snapshot may have fewer.
        const pictures = events.filter((e) => e.t === 'traffic')
        const fullest = pictures.reduce((best, e) =>
          e.t === 'traffic' && best.t === 'traffic' && e.targets.length > best.targets.length
            ? e
            : best,
        )
        if (fullest.t !== 'traffic') throw new Error('unreachable')
        const targets: AdsbTarget[] = fullest.targets

        // Distinct aircraft, not one target decoded several times -- which
        // is what a mis-read ICAO address looks like from the outside.
        const addresses = new Set(targets.map((t) => t.icao))
        expect(addresses.size).toBe(targets.length)
        expect(targets.length).toBeGreaterThan(1)
        expect(targets.length).toBeLessThanOrEqual(TRAFFIC)
        for (const t of targets) expect(t.icao).toBeGreaterThan(0)

        // Every target here has a position, because a report without one is
        // dropped rather than placed at zero -- so this asserts the drop as
        // much as the decode.
        for (const t of targets) {
          expect(Math.abs(t.latDeg)).toBeGreaterThan(0)
          expect(Math.abs(t.latDeg)).toBeLessThanOrEqual(90)
          expect(Math.abs(t.lonDeg)).toBeLessThanOrEqual(180)
        }

        // The simulator flies its traffic near the vehicle at plausible
        // heights and speeds. Loose bounds on purpose: this is checking that
        // the *scales* are right -- millimeters for altitude, centimeters a
        // second for velocity, centidegrees for heading -- and a factor-of-
        // ten error in any of them lands far outside these.
        const withAlt = targets.filter((t) => t.altMslM !== null)
        expect(withAlt.length).toBeGreaterThan(0)
        for (const t of withAlt) expect(t.altMslM!).toBeGreaterThan(-500)
        for (const t of withAlt) expect(t.altMslM!).toBeLessThan(20000)

        for (const t of targets) {
          if (t.headingDeg !== null) {
            expect(t.headingDeg).toBeGreaterThanOrEqual(0)
            expect(t.headingDeg).toBeLessThan(360)
          }
          // Faster than any airliner would be a unit error, not an aircraft.
          if (t.groundSpeedMs !== null) expect(t.groundSpeedMs).toBeLessThan(400)
        }

        // ArduPilot marks its own simulated traffic, and the app says so on
        // screen -- worth knowing this is where that flag comes from.
        expect(targets.some((t) => t.simulated)).toBe(true)

        // The picture is a snapshot of everything heard, sent about once a
        // second -- not one event per report, which for four aircraft each
        // reporting at 1 Hz would be four times as many.
        expect(pictures.length).toBeGreaterThan(0)
        expect(pictures.length).toBeLessThan(events.filter((e) => e.t === 'telemetry').length)
      } finally {
        // Nothing to put back: the configuration came from the launch, and
        // the runner wipes storage on every relaunch anyway.
        engine.stop()
        socket.destroy()
      }
    },
    180000,
  )
})
