// @vitest-environment node
//
// Integration against REAL ArduPilot SITL over TCP -- the check the original
// ArduConfigurator never had. Start SITL first (npm run sitl), then:
//   SITL=1 npm test
// Skipped otherwise, so the ordinary unit run never needs a simulator.
import { describe, expect, it } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { ProtocolEngine } from './engine'
import type { ProtocolEvent } from './types'

const SITL_HOST = '127.0.0.1'
const SITL_PORT = 5760

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

// scripts/sitl.mjs relaunches SITL after each client disconnect; a fresh
// boot takes a moment to open its TCP server, so connecting retries.
async function connectSitl(): Promise<net.Socket> {
  const deadline = Date.now() + 30000
  for (;;) {
    try {
      const socket = net.connect(SITL_PORT, SITL_HOST)
      await once(socket, 'connect')
      return socket
    } catch {
      if (Date.now() > deadline) throw new Error('could not reach SITL on TCP 5760')
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

// Connect AND see a heartbeat. A relaunching SITL can accept a connection
// mid-boot and then stall; dropping that connection makes the runner spawn
// a fresh one, so retrying the whole handshake self-heals.
async function connectVehicle(
  engine: ProtocolEngine,
  events: ProtocolEvent[],
  setSocket: (s: net.Socket | null) => void,
): Promise<net.Socket> {
  for (let attempt = 0; ; attempt++) {
    const socket = await connectSitl()
    const seen = events.length
    // Wire tx before starting: the engine requests streams the moment the
    // first heartbeat lands, and that send must not fall on the floor.
    setSocket(socket)
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()
    try {
      await waitFor(
        () => events.slice(seen).some((e) => e.t === 'heartbeat'),
        20000,
        'first heartbeat',
      )
      return socket
    } catch (err) {
      engine.stop()
      setSocket(null)
      socket.destroy()
      if (attempt >= 2) throw err
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

describe.runIf(process.env.SITL === '1')('SITL integration', () => {
  it(
    'handshakes with real ArduPilot and receives streamed telemetry',
    async () => {
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      try {
        const hb = events.find((e) => e.t === 'heartbeat')
        if (hb?.t !== 'heartbeat') throw new Error('unreachable')
        expect(hb.autopilot).toBe(3) // MAV_AUTOPILOT_ARDUPILOTMEGA: this is really ArduPilot
        expect(hb.sysid).toBe(1)

        // Our REQUEST_DATA_STREAM must make SITL stream attitude/position.
        await waitFor(() => events.some((e) => e.t === 'telemetry'), 15000, 'telemetry stream')
        const kinds = new Set(
          events.flatMap((e) => (e.t === 'telemetry' ? e.batch.map((d) => d.k) : [])),
        )
        expect(kinds.has('attitude')).toBe(true)

        // ArduPilot always talks at boot; STATUSTEXT decode is exercised too.
        await waitFor(() => events.some((e) => e.t === 'statustext'), 15000, 'statustext')

        // And the link must be clean: no CRC failures against a real stream.
        const lastStats = [...events].reverse().find((e) => e.t === 'linkStats')
        if (lastStats?.t === 'linkStats') {
          expect(lastStats.stats.badFrames).toBe(0)
        }
        // --- Parameters: the Phase 2 gate, against the real generator. ---
        const t0 = Date.now()
        const result = await engine.downloadParams()
        const elapsed = Date.now() - t0
        expect(result.source).toBe('ftp') // real ArduPilot serves @PARAM/param.pck
        expect(result.params.length).toBeGreaterThan(500) // a Copter has ~1400
        expect(elapsed).toBeLessThan(3000) // the "<3 s over TCP" phase gate

        const frameClass = result.params.find((p) => p.name === 'FRAME_CLASS')
        expect(frameClass).toBeDefined()

        // Write + verify + restore a harmless parameter. 4.7 renamed
        // LOIT_SPEED (cm/s) to LOIT_SPEED_MS (m/s); accept either vintage.
        const loit = result.params.find(
          (p) => p.name === 'LOIT_SPEED_MS' || p.name === 'LOIT_SPEED',
        )
        expect(loit).toBeDefined()
        const newValue = loit!.value + 1
        const echoed = await engine.setParam(loit!.name, newValue, loit!.mavType)
        expect(echoed).toBeCloseTo(newValue, 3)
        const restored = await engine.setParam(loit!.name, loit!.value, loit!.mavType)
        expect(restored).toBeCloseTo(loit!.value, 3)

        // --- OSD: the screen editor's assumption, checked against real
        // firmware. The editor is built on every panel being an
        // OSD{screen}_{PANEL}_{EN,X,Y} triplet, so a panel with a missing
        // coordinate would be a control that writes a parameter the vehicle
        // does not have. The OSD is a compile-time option, hence the guard --
        // a build without it is a legitimate configuration, not a failure.
        const names = new Set(result.params.map((p) => p.name))
        const enables = [...names].filter((n) => /^OSD1_.+_EN$/.test(n))
        if (enables.length === 0) {
          console.warn('SITL build has no OSD compiled in; skipping the OSD layout checks')
        } else {
          expect(enables.length).toBeGreaterThan(20) // real firmware carries ~65
          const brokenTriplets = enables
            .map((n) => n.replace(/^OSD1_/, '').replace(/_EN$/, ''))
            .filter((stem) => !names.has(`OSD1_${stem}_X`) || !names.has(`OSD1_${stem}_Y`))
          expect(brokenTriplets).toEqual([])

          // Four layout screens, as the screen picker offers.
          for (const n of [1, 2, 3, 4]) expect(names.has(`OSD${n}_ENABLE`)).toBe(true)

          // And a coordinate really is writable: this is what dragging a
          // panel and hitting Write Params comes down to.
          const altX = result.params.find((p) => p.name === 'OSD1_ALTITUDE_X')
          expect(altX).toBeDefined()
          const moved = await engine.setParam(altX!.name, altX!.value + 1, altX!.mavType)
          expect(moved).toBeCloseTo(altX!.value + 1, 3)
          const putBack = await engine.setParam(altX!.name, altX!.value, altX!.mavType)
          expect(putBack).toBeCloseTo(altX!.value, 3)
        }

        // --- Commands: the Phase 3 gate. Start a compass calibration on the
        // real firmware, see MAG_CAL_PROGRESS stream, then cancel it.
        const startResult = await engine.runCommand(42424, [0, 0, 0, 0, 0, 0, 0], 5000)
        expect(startResult).toBe(0) // MAV_RESULT_ACCEPTED
        await waitFor(
          () => events.some((e) => e.t === 'magCalProgress'),
          10000,
          'MAG_CAL_PROGRESS from real firmware',
        )
        const cancelResult = await engine.runCommand(42426, [0], 5000)
        expect(cancelResult).toBe(0)

        // A command ArduPilot rejects must come back as a code, not a hang:
        // motor test while disarmed on the bench answers deterministically.
        const motorResult = await engine.runCommand(209, [1, 0, 5, 1, 0, 0, 0], 5000)
        expect([0, 1, 2, 3, 4]).toContain(motorResult)
      } finally {
        engine.stop()
        socket?.destroy()
      }
    },
    90000,
  )

  it(
    'flies: guided mode, arm, takeoff to altitude, RTL (the Phase 5 gate)',
    async () => {
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      const lastMode = () => {
        const hb = [...events].reverse().find((e) => e.t === 'heartbeat')
        return hb?.t === 'heartbeat' ? hb.customMode : -1
      }
      const relAlt = () => {
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]!
          if (e.t === 'telemetry') {
            for (let j = e.batch.length - 1; j >= 0; j--) {
              const d = e.batch[j]!
              if (d.k === 'position') return d.relAltM
            }
          }
        }
        return 0
      }

      try {
        // GUIDED is Copter mode 4.
        expect(await engine.runCommand(176, [1, 4, 0, 0, 0, 0, 0], 5000)).toBe(0)
        await waitFor(() => lastMode() === 4, 10000, 'guided mode in heartbeat')

        // Arm + takeoff as one resilient sequence. A freshly-wiped SITL
        // needs the EKF position estimate before it arms; the arm ack can
        // land before the armed heartbeat; and an armed copter that sits on
        // the ground auto-disarms. So: (re)arm whenever the heartbeat says
        // disarmed, confirm via heartbeat, and retry takeoff until accepted.
        const armedNow = () => {
          const hb = [...events].reverse().find((e) => e.t === 'heartbeat')
          return hb?.t === 'heartbeat' && (hb.baseMode & 128) !== 0
        }
        const deadline = Date.now() + 150000
        let lastArm = -99
        let lastTakeoff = -99
        for (;;) {
          if (Date.now() > deadline) {
            const texts = events
              .filter((e) => e.t === 'statustext')
              .map((e) => (e.t === 'statustext' ? e.text : ''))
              .slice(-8)
            throw new Error(
              `SITL never accepted takeoff (last arm ${lastArm}, last takeoff ${lastTakeoff}, armed ${armedNow()}). Vehicle said: ${texts.join(' | ')}`,
            )
          }
          // SITL's simulated RC can knock the mode off Guided as its input
          // channels come alive; re-assert it every round.
          if (lastMode() !== 4) {
            await engine.runCommand(176, [1, 4, 0, 0, 0, 0, 0], 5000).catch(() => -1)
            await waitFor(() => lastMode() === 4, 5000, 'guided').catch(() => {})
          }
          if (!armedNow()) {
            lastArm = await engine.runCommand(400, [1, 0, 0, 0, 0, 0, 0], 5000).catch(() => -1)
            if (lastArm !== 0) {
              await new Promise((r) => setTimeout(r, 3000))
              continue
            }
            await waitFor(armedNow, 5000, 'armed heartbeat').catch(() => {})
          }
          lastTakeoff = await engine.runCommand(22, [0, 0, 0, 0, 0, 0, 20], 5000).catch(() => -1)
          if (lastTakeoff === 0) break
          await new Promise((r) => setTimeout(r, 2000))
        }
        await waitFor(() => relAlt() > 15, 60000, 'climb past 15 m')

        // RTL is Copter mode 6.
        expect(await engine.runCommand(176, [1, 6, 0, 0, 0, 0, 0], 5000)).toBe(0)
        await waitFor(() => lastMode() === 6, 10000, 'RTL mode in heartbeat')
      } finally {
        engine.stop()
        socket?.destroy()
      }
    },
    240000,
  )
})
