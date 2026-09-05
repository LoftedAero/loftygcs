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
import {
  fenceFromItems,
  fenceToItems,
  rallyFromItems,
  rallyToItems,
} from './geofence'
import { parseHome } from '../sim-home'
import { parseDataflash } from './dataflash'
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
    // SITL exits the moment its one client disconnects, so tearing a test
    // down races its shutdown and the reset arrives as an unhandled
    // exception -- which made a fully green run exit non-zero, defeating the
    // gate the run exists to be. There is nothing to recover from here: the
    // test is already over.
    socket.on('error', () => {})
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

        // The vehicle says what firmware it is, which is what picks
        // matching parameter metadata. Field names on the decoded message
        // are the decoder's, not ours, so this is the only place that
        // catches a rename or a mis-cased key -- a wrong key reads as
        // undefined and silently decodes to version 0.0.0.
        await waitFor(() => events.some((e) => e.t === 'version'), 15000, 'AUTOPILOT_VERSION')
        const version = events.find((e) => e.t === 'version')
        if (version?.t !== 'version') throw new Error('unreachable')
        expect(version.firmware.major).toBeGreaterThanOrEqual(4)
        expect(version.firmware.minor).toBeLessThan(100)
        // MAV_PROTOCOL_CAPABILITY_FTP; a real ArduPilot has it, and this is
        // what lets a screen tell "no MAVFTP" from "MAVFTP not answering".
        expect(version.capabilities & (1 << 11)).toBeTruthy()

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

        // --- Missions: the Phase 6 gate. Upload against the real storage
        // and read back what it kept -- the virtual FC agreeing with us
        // proves nothing about ArduPilot's mission validation.
        const home = await engine.downloadMission(0).then((m) => m[0])
        const wp = (seq: number, lat: number, lon: number, alt: number) => ({
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
        const plan = [
          // Seq 0 is home; SITL replaces its content with its own home, so
          // send the one it reported and compare positions loosely below.
          { ...(home ?? wp(0, -35.363262, 149.165237, 584)), seq: 0, current: 1 },
          { ...wp(1, 0, 0, 30), command: 22 }, // NAV_TAKEOFF
          wp(2, -35.3625, 149.1642, 45),
          wp(3, -35.3618, 149.1655, 55),
          { ...wp(4, 0, 0, 0), command: 20 }, // NAV_RETURN_TO_LAUNCH
        ]
        await engine.uploadMission(plan, 0)
        const readBack = await engine.downloadMission(0)
        expect(readBack).toHaveLength(plan.length)
        // Items after home must survive byte-exact in the fields that matter.
        // Except the frame on commands that carry no coordinates: ArduPilot
        // stores those without one and reports frame 0 on read-back (our RTL
        // went up as frame 3 and came home as 0 -- found here, first contact).
        // The mission store must not read that as a difference either.
        for (let i = 1; i < plan.length; i++) {
          expect(readBack[i]).toMatchObject({
            seq: i,
            command: plan[i]!.command,
            x: plan[i]!.x,
            y: plan[i]!.y,
          })
          if (plan[i]!.command === 16) expect(readBack[i]!.frame).toBe(plan[i]!.frame)
          expect(readBack[i]!.z).toBeCloseTo(plan[i]!.z, 3)
        }

        // And a bad mission must be refused with a code, not accepted or
        // hung: a DO_JUMP to a sequence that does not exist.
        const broken = [
          plan[0]!,
          { ...wp(1, 0, 0, 0), command: 177, param1: 99, param2: 1 }, // DO_JUMP -> 99
        ]
        await expect(engine.uploadMission(broken, 0)).rejects.toThrow(/refused/i)

        // Leave SITL holding the good mission, restored for whoever's next.
        await engine.uploadMission(plan, 0)
      } finally {
        engine.stop()
        socket?.destroy()
      }
    },
    90000,
  )

  // Runs only when SITL was launched somewhere specific:
  //   npm run sitl -- --home 38.9034,-77.0365,20,90
  //   SITL=1 SITL_HOME=38.9034,-77.0365,20,90 npm test
  // Which is the whole point of being able to set it -- a simulator at your
  // own field is only useful if the vehicle actually reports being there.
  it.runIf(process.env.SITL_HOME)(
    'boots where it was told to',
    async () => {
      const parsed = parseHome(process.env.SITL_HOME ?? '')
      if ('error' in parsed) throw new Error(`SITL_HOME: ${parsed.error}`)
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      const fix = () => {
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]!
          if (e.t !== 'telemetry') continue
          for (let j = e.batch.length - 1; j >= 0; j--) {
            const d = e.batch[j]!
            // A zero fix is SITL before its GPS has settled, not a vehicle
            // at null island.
            if (d.k === 'position' && d.latDeg !== 0) return d
          }
        }
        return null
      }

      try {
        await waitFor(() => fix() !== null, 30000, 'a GPS fix')
        const at = fix()!
        // Loose: SITL's simulated GPS wanders a few meters around home, and
        // 1e-4 degrees is about 11 m.
        expect(at.latDeg).toBeCloseTo(parsed.home.latDeg, 3)
        expect(at.lonDeg).toBeCloseTo(parsed.home.lonDeg, 3)
      } finally {
        engine.stop()
        socket?.destroy()
      }
    },
    60000,
  )

  it(
    'lists and downloads a dataflash log over MAVFTP',
    async () => {
      // The listing opcode is the one that does not work like the others:
      // its offset field is an entry index rather than a byte offset, and
      // the device ends the listing by NAKing EndOfFile, which is a normal
      // reply. Both are easy to get wrong against a scripted fake and
      // obvious against a real one.
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      try {
        // SITL has no SD card: it runs on the host filesystem rooted at
        // its working directory, so its logs are at /logs where real
        // hardware mounts them at /APM/LOGS. The service probes both; this
        // test names the one the simulator actually has.
        const entries = await engine.listFiles('/logs')
        // SITL has been flying throughout this suite, so it has logs.
        const logs = entries.filter((e) => e.kind === 'file' && /\.bin$/i.test(e.name))
        expect(logs.length).toBeGreaterThan(0)
        // Sizes come back with the names, which is what lets the UI say
        // what a download is going to cost before starting it.
        expect(logs.some((l) => (l.size ?? 0) > 0)).toBe(true)
        // The listing includes '.' and '..' as directories; neither is a
        // log and neither may reach the picker.
        expect(logs.some((l) => l.name === '.' || l.name === '..')).toBe(false)

        // Take the smallest, so this test is about the mechanism and not
        // about waiting for ten megabytes over a loopback socket.
        const smallest = logs
          .filter((l) => (l.size ?? 0) > 0)
          .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0]!
        const bytes = await engine.downloadFile(`/logs/${smallest.name}`)
        expect(bytes.length).toBe(smallest.size)

        // And it is a real log: the parser reads it, header and all.
        const parsed = parseDataflash(bytes)
        expect(parsed.messages.size).toBeGreaterThan(10)
        expect(parsed.problems).toEqual([])

        // Progress was reported, or a long transfer looks like a hang.
        const progress = events.filter((e) => e.t === 'fileProgress')
        expect(progress.length).toBeGreaterThan(0)
      } finally {
        engine.stop()
        socket?.destroy()
      }
    },
    240000,
  )

  it(
    'writes, reads back and deletes a file over MAVFTP',
    async () => {
      // The write path has no burst mode and no fallback, so nothing about
      // it is exercised by the download test: CreateFile hands back a
      // session that every WriteFile has to use, the offsets are absolute,
      // and a real autopilot is the only thing that will complain if any of
      // that is wrong. A scripted fake agrees with whatever we wrote.
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      // Bigger than one 239-byte chunk, and not a repeating pattern: a
      // chunking bug that reordered or dropped a block would still produce
      // the right length.
      // Bigger than one 239-byte chunk, and not a repeating pattern: a
      // chunking bug that reordered or dropped a block would still produce
      // the right length.
      const content = new Uint8Array(1500).map((_, i) => (i * 37 + (i >> 3)) & 0xff)
      // In a directory this test makes, not at the root. ArduPilot's FTP
      // root is a merged view of the mounts (@ROMFS, @SYS) beside the real
      // filesystem, and a file created there does not come back in the
      // listing -- found here rather than assumed. Real hardware has the
      // same shape with the card at /APM.
      const dir = '/loftgcs-ftp-test'
      const path = `${dir}/written.bin`

      try {
        await engine.createDirectory(dir)
        await engine.uploadFile(path, content)

        // It is really there, with the size we wrote.
        const listing = await engine.listFiles(dir)
        const entry = listing.find((e) => e.name === 'written.bin')
        expect(entry).toBeDefined()
        expect(entry!.size).toBe(content.length)

        // And it is really what we wrote, byte for byte.
        const back = await engine.downloadFile(path)
        expect(back).toEqual(content)

        // Progress was reported on the way up, or a slow write looks hung.
        const sent = events.filter((e) => e.t === 'fileProgress' && e.path === path)
        expect(sent.length).toBeGreaterThan(0)

        // Rename, which packs two paths into one payload -- the only
        // opcode that does.
        await engine.renameFile(path, `${dir}/moved.bin`)
        const renamed = await engine.listFiles(dir)
        expect(renamed.map((e) => e.name)).toContain('moved.bin')
        expect(renamed.map((e) => e.name)).not.toContain('written.bin')

        await engine.removeFile(`${dir}/moved.bin`)
        await engine.removeDirectory(dir)
        // A directory that is gone cannot be listed; that is the proof.
        await expect(engine.listFiles(dir)).rejects.toThrow()
      } finally {
        // Never leave anything behind: SITL's working directory is the
        // checkout, and the next run should start clean whatever failed.
        await engine.removeFile(path).catch(() => {})
        await engine.removeFile(`${dir}/moved.bin`).catch(() => {})
        await engine.removeDirectory(dir).catch(() => {})
        engine.stop()
        socket?.destroy()
      }
    },
    120000,
  )

  it(
    'round trips a geofence and rally points through real ArduPilot',
    async () => {
      const events: ProtocolEvent[] = []
      let socket: net.Socket | null = null
      const engine = new ProtocolEngine((out) => {
        if (out.t === 'tx') socket?.write(out.bytes)
        else if (out.t === 'evt') events.push(out.evt)
      })
      socket = await connectVehicle(engine, events, (s) => (socket = s))

      try {
        // Around SITL's default home at Canberra. Two polygons of the SAME
        // kind and the SAME vertex count, deliberately: on the wire nothing
        // separates them but the running count each vertex carries in
        // param1, and this is the case that proves the grouping is real
        // rather than an artifact of our own serializer.
        const box = (lat: number, lon: number, d: number) => [
          { x: Math.round((lat - d) * 1e7), y: Math.round((lon - d) * 1e7) },
          { x: Math.round((lat + d) * 1e7), y: Math.round((lon - d) * 1e7) },
          { x: Math.round((lat + d) * 1e7), y: Math.round((lon + d) * 1e7) },
          { x: Math.round((lat - d) * 1e7), y: Math.round((lon + d) * 1e7) },
        ]
        const fence = {
          shapes: [
            { uid: 'a', kind: 'polygon' as const, inclusive: true, points: box(-35.3632, 149.1652, 0.004) },
            { uid: 'b', kind: 'polygon' as const, inclusive: true, points: box(-35.3700, 149.1750, 0.004) },
            {
              uid: 'c',
              kind: 'circle' as const,
              inclusive: false,
              center: { x: -353640000, y: 1491660000 },
              radiusM: 75,
            },
          ],
          returnPoint: { x: -353632620, y: 1491652370 },
        }

        await engine.uploadMission(fenceToItems(fence), 1)
        const backItems = await engine.downloadMission(1)
        const { plan: back, problems } = fenceFromItems(backItems)
        expect(problems).toEqual([])
        expect(back.shapes).toHaveLength(3)
        // The two same-kind polygons came back as two, not one of eight
        // vertices and not one of four with four dropped.
        expect(back.shapes.filter((x) => x.kind === 'polygon')).toHaveLength(2)
        for (const shape of back.shapes) {
          if (shape.kind === 'polygon') expect(shape.points).toHaveLength(4)
        }
        const circle = back.shapes.find((x) => x.kind === 'circle')
        expect(circle?.kind === 'circle' && circle.radiusM).toBeCloseTo(75, 1)
        expect(back.returnPoint?.x).toBe(fence.returnPoint.x)

        // An empty fence must actually remove it, not be a no-op: a fence
        // you think you deleted but the vehicle still enforces is the worst
        // outcome available.
        await engine.uploadMission([], 1)
        expect(await engine.downloadMission(1)).toHaveLength(0)

        // --- Rally points ---
        const rally = [
          { uid: 'r1', x: -353620000, y: 1491640000, altM: 60 },
          { uid: 'r2', x: -353650000, y: 1491680000, altM: 90 },
        ]
        await engine.uploadMission(rallyToItems(rally), 2)
        const readRally = rallyFromItems(await engine.downloadMission(2))
        expect(readRally).toHaveLength(2)
        for (let i = 0; i < rally.length; i++) {
          expect(readRally[i]!.x).toBe(rally[i]!.x)
          expect(readRally[i]!.y).toBe(rally[i]!.y)
          expect(readRally[i]!.altM).toBeCloseTo(rally[i]!.altM, 1)
        }

        // Leave the vehicle as we found it.
        await engine.uploadMission([], 2)
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
