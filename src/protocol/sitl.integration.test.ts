// @vitest-environment node
//
// Integration tests against real ArduPilot SITL over TCP. Start SITL first
// (npm run sitl), then:
//   SITL=1 npm test
// Skipped otherwise.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import { fenceFromItems, fenceToItems, rallyFromItems, rallyToItems } from './geofence'
import { parseHome } from '../sim-home'
import { parseDataflash } from './dataflash'
import { ignoreValue, RELEASE } from './joystick'
import type { ProtocolEvent } from './types'

/** MAV_TYPE values that are copters, from the heartbeat. */
const COPTER_TYPES = new Set([2, 3, 13, 14, 15])

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
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
    // SITL exits when its one client disconnects, so teardown races its
    // shutdown and the reset would surface as an unhandled exception that
    // fails an otherwise green run.
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
  it('handshakes with real ArduPilot and receives streamed telemetry', async () => {
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

      // The firmware version picks the parameter metadata. Field names come
      // from the decoder, so this catches a renamed or mis-cased key, which
      // would silently decode as version 0.0.0.
      await waitFor(() => events.some((e) => e.t === 'version'), 15000, 'AUTOPILOT_VERSION')
      const version = events.find((e) => e.t === 'version')
      if (version?.t !== 'version') throw new Error('unreachable')
      expect(version.firmware.major).toBeGreaterThanOrEqual(4)
      expect(version.firmware.minor).toBeLessThan(100)
      // Only that the field is read, not that any particular bit is set:
      // ArduPlane reports no MAV_PROTOCOL_CAPABILITY_FTP bit yet serves MAVFTP,
      // as the parameter download below shows.
      expect(version.capabilities).toBeGreaterThan(0)

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
      expect(result.params.length).toBeGreaterThan(500) // Copter ~1400, Plane ~1300
      // The Phase 2 gate. Copter serves its ~1,370 parameters in about 2.5 s
      // and Plane its ~1,419 in about 3.1 s. The gate exists to catch a fall
      // back to the PARAM_REQUEST_LIST stream, which takes thirty seconds or
      // more.
      expect(elapsed).toBeLessThan(3500)

      // A parameter every vehicle has, to prove the set is real. FRAME_CLASS
      // is absent on a fixed wing and SYSID_THISMAV is renamed MAV_SYSID in
      // current firmware; FORMAT_VERSION, the storage format marker, is
      // always present.
      expect(result.params.find((p) => p.name === 'FORMAT_VERSION')).toBeDefined()

      // Write, verify and restore a harmless parameter. Copter 4.7 renamed
      // LOIT_SPEED (cm/s) to LOIT_SPEED_MS (m/s), and Plane has neither
      // (WP_LOITER_RAD instead), so use whichever this vehicle carries.
      const loit = result.params.find((p) =>
        ['LOIT_SPEED_MS', 'LOIT_SPEED', 'WP_LOITER_RAD'].includes(p.name),
      )
      expect(loit).toBeDefined()
      const newValue = loit!.value + 1
      const echoed = await engine.setParam(loit!.name, newValue, loit!.mavType)
      expect(echoed).toBeCloseTo(newValue, 3)
      const restored = await engine.setParam(loit!.name, loit!.value, loit!.mavType)
      expect(restored).toBeCloseTo(loit!.value, 3)

      // --- OSD: the editor assumes every panel is an
      // OSD{screen}_{PANEL}_{EN,X,Y} triplet. The OSD is a compile-time
      // option, so a build without it is skipped rather than failed.
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

        // A coordinate is writable, which is what dragging a panel does.
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

      // --- Missions: the Phase 6 gate. Upload to real mission storage and
      // read back what it kept.
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
      // Items after home must survive exactly in the fields that matter,
      // except the frame on commands with no coordinates: ArduPilot stores
      // those without one and reports frame 0 on read-back.
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
  }, 90000)

  // Runs only when SITL was launched at a specific home:
  //   npm run sitl -- --home 38.9034,-77.0365,20,90
  //   SITL=1 SITL_HOME=38.9034,-77.0365,20,90 npm test
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

  it('lists and downloads a dataflash log over MAVFTP', async () => {
    // The listing opcode's offset is an entry index rather than a byte
    // offset, and the device ends the listing by NAKing EndOfFile.
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    try {
      // SITL keeps its logs at /logs, where real hardware uses /APM/LOGS.
      const entries = await engine.listFiles('/logs')
      // SITL has been flying throughout this suite, so it has logs.
      const logs = entries.filter((e) => e.kind === 'file' && /\.bin$/i.test(e.name))
      expect(logs.length).toBeGreaterThan(0)
      // Sizes come back with the names.
      expect(logs.some((l) => (l.size ?? 0) > 0)).toBe(true)
      // The listing includes '.' and '..' as directories.
      expect(logs.some((l) => l.name === '.' || l.name === '..')).toBe(false)

      // The smallest, to keep the test quick.
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
  }, 240000)

  it('writes, reads back and deletes a file over MAVFTP', async () => {
    // The write path has no burst mode and no fallback: CreateFile returns
    // a session every WriteFile must use, and offsets are absolute.
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    // Larger than one 239-byte chunk and not a repeating pattern, so a
    // reordered or dropped block shows.
    const content = new Uint8Array(1500).map((_, i) => (i * 37 + (i >> 3)) & 0xff)
    // Not at the root: ArduPilot's FTP root is a merged view of the virtual
    // mounts (@ROMFS, @SYS) and the real filesystem, and a file created
    // there does not appear in the listing.
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

      // Rename is the only opcode that packs two paths into one payload.
      await engine.renameFile(path, `${dir}/moved.bin`)
      const renamed = await engine.listFiles(dir)
      expect(renamed.map((e) => e.name)).toContain('moved.bin')
      expect(renamed.map((e) => e.name)).not.toContain('written.bin')

      await engine.removeFile(`${dir}/moved.bin`)
      await engine.removeDirectory(dir)
      // A directory that is gone cannot be listed; that is the proof.
      await expect(engine.listFiles(dir)).rejects.toThrow()
    } finally {
      // SITL's working directory is the checkout, so always clean up.
      await engine.removeFile(path).catch(() => {})
      await engine.removeFile(`${dir}/moved.bin`).catch(() => {})
      await engine.removeDirectory(dir).catch(() => {})
      engine.stop()
      socket?.destroy()
    }
  }, 120000)

  it('speaks the mount and camera protocols this firmware actually has', async () => {
    // Which mount protocol generations this firmware understands, and what
    // it answers with no mount: ArduPilot answers all of them even with
    // MNT1_TYPE at zero, and only the result code tells "pointed" from "no
    // mount configured".
    //
    // A configured mount cannot be tested: MNT1_TYPE needs a reboot, and the
    // runner wipes parameters on every launch. gimbal.test.ts covers the
    // angle decode.
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    try {
      const params = await engine.downloadParams()
      expect(params.params.find((p) => p.name === 'MNT1_TYPE')?.value).toBe(0)

      // MAV_RESULT: 0 accepted, 3 unsupported, 4 failed. 4 means understood
      // but no mount; 3 would mean the station should send the older command.
      const pitchYaw = await engine.runCommand(1000, [-45, 0, 0, 0, 8, 0, 0], 8000)
      expect(pitchYaw).toBe(4)
      const mountControl = await engine.runCommand(205, [-45, 0, 0, 0, 0, 0, 2], 8000)
      expect(mountControl).toBe(4)
      // Same for the camera: understood, nothing to trigger.
      expect(await engine.runCommand(2000, [0, 0, 1, 0, 0, 0, 0], 8000)).toBe(4)

      // Current firmware denies a request for MOUNT_STATUS (158) and accepts
      // GIMBAL_DEVICE_ATTITUDE_STATUS (285). Both decoders are kept for older
      // vehicles.
      const modern = await engine.runCommand(511, [285, 200000, 0, 0, 0, 0, 0], 8000)
      const legacy = await engine.runCommand(511, [158, 200000, 0, 0, 0, 0, 0], 8000)
      expect(modern).toBe(0)
      expect(legacy).not.toBe(0)
    } finally {
      engine.stop()
      socket?.destroy()
    }
  }, 120000)

  it('flies the sticks: an RC override reaches the vehicle and is handed back', async () => {
    // The encoder accepts any field name, so a wrong one (chan1_raw for
    // chan1Raw) produces a well-formed message full of zeros.
    //
    // Handing control back matters most: a station that stops sending leaves
    // the vehicle holding the last stick position until its RC failsafe
    // notices.
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    const latest = (field: string): number | undefined => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.t === 'fields' && e.values[field] !== undefined) return e.values[field]
      }
      return undefined
    }
    const override = (channels: number[]) => {
      const fields: Record<string, number> = { targetSystem: 1, targetComponent: 1 }
      channels.forEach((v, i) => (fields[`chan${i + 1}Raw`] = v))
      engine.send('RC_CHANNELS_OVERRIDE', fields)
    }

    try {
      await waitFor(
        () => latest('RC_CHANNELS.chan1Raw') !== undefined,
        20000,
        'the RC_CHANNELS stream',
      )
      const before = latest('RC_CHANNELS.chan1Raw')!

      // Four distinct values, none of them the resting one, so no channel
      // can pass by accident.
      const wanted = [1234, 1345, 1456, 1567, 0, 0, 0, 0]
      const held = setInterval(() => override(wanted), 100)
      try {
        await waitFor(
          () =>
            latest('RC_CHANNELS.chan1Raw') === 1234 &&
            latest('RC_CHANNELS.chan2Raw') === 1345 &&
            latest('RC_CHANNELS.chan3Raw') === 1456 &&
            latest('RC_CHANNELS.chan4Raw') === 1567,
          20000,
          'the vehicle to read the overridden sticks',
        )
      } finally {
        clearInterval(held)
      }

      // Zero releases the channel back to the simulated receiver.
      for (let i = 0; i < 3; i++) {
        override([0, 0, 0, 0, 0, 0, 0, 0])
        await new Promise((r) => setTimeout(r, 60))
      }
      await waitFor(
        () => latest('RC_CHANNELS.chan1Raw') === before,
        20000,
        'the vehicle to take its sticks back',
      )
    } finally {
      // Never leave a simulator flying on a stale override.
      for (let i = 0; i < 3; i++) override([0, 0, 0, 0, 0, 0, 0, 0])
      await new Promise((r) => setTimeout(r, 200))
      engine.stop()
      socket?.destroy()
    }
  }, 120000)

  it('hands back a channel above 8 with its own release value, not zero', async () => {
    // Above channel 8 zero means "no change" and 65534 is the release, so a
    // release of zeros leaves a switch channel held. RELEASE and ignoreValue
    // are the app's own, so this pins what the joystick service transmits.
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    const latest = (field: string): number | undefined => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]
        if (e?.t === 'fields' && e.values[field] !== undefined) return e.values[field]
      }
      return undefined
    }
    const override = (channels: readonly number[]) => {
      const fields: Record<string, number> = { targetSystem: 1, targetComponent: 1 }
      channels.forEach((v, i) => (fields[`chan${i + 1}Raw`] = v))
      engine.send('RC_CHANNELS_OVERRIDE', fields)
    }
    /** Every channel left alone except channel 10. */
    const ch10 = (value: number) =>
      Array.from({ length: 18 }, (_, i) => (i === 9 ? value : ignoreValue(i + 1)))
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const HELD = 1678

    try {
      await waitFor(
        () => latest('RC_CHANNELS.chan10Raw') !== undefined,
        20000,
        'the RC_CHANNELS stream',
      )
      const before = latest('RC_CHANNELS.chan10Raw')!
      expect(before).not.toBe(HELD)

      const hold = setInterval(() => override(ch10(HELD)), 100)
      try {
        await waitFor(
          () => latest('RC_CHANNELS.chan10Raw') === HELD,
          20000,
          'the vehicle to read the overridden channel 10',
        )
      } finally {
        clearInterval(hold)
      }

      // Zero on channel 10 is "no change": for a second (well inside
      // RC_OVERRIDE_TIME's default of 3 s) it must go on reading HELD.
      for (let i = 0; i < 10; i++) {
        override(ch10(0))
        await pause(100)
      }
      expect(latest('RC_CHANNELS.chan10Raw')).toBe(HELD)

      // Refresh the override so its timeout cannot be what hands it back,
      // then send the app's release and expect it back within a second.
      override(ch10(HELD))
      await pause(200)
      for (let i = 0; i < 3; i++) {
        override(RELEASE)
        await pause(60)
      }
      const released = Date.now()
      await waitFor(
        () => latest('RC_CHANNELS.chan10Raw') === before,
        1500,
        'the vehicle to take channel 10 back',
      )
      expect(Date.now() - released).toBeLessThan(1500)
    } finally {
      for (let i = 0; i < 3; i++) override(RELEASE)
      await pause(200)
      engine.stop()
      socket?.destroy()
    }
  }, 120000)

  it('round trips a geofence and rally points through real ArduPilot', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    try {
      // Around SITL's default home at Canberra. Two polygons of the same
      // kind and vertex count: on the wire only the vertex count each item
      // carries in param1 separates them.
      const box = (lat: number, lon: number, d: number) => [
        { x: Math.round((lat - d) * 1e7), y: Math.round((lon - d) * 1e7) },
        { x: Math.round((lat + d) * 1e7), y: Math.round((lon - d) * 1e7) },
        { x: Math.round((lat + d) * 1e7), y: Math.round((lon + d) * 1e7) },
        { x: Math.round((lat - d) * 1e7), y: Math.round((lon + d) * 1e7) },
      ]
      const fence = {
        shapes: [
          {
            uid: 'a',
            kind: 'polygon' as const,
            inclusive: true,
            points: box(-35.3632, 149.1652, 0.004),
          },
          {
            uid: 'b',
            kind: 'polygon' as const,
            inclusive: true,
            points: box(-35.37, 149.175, 0.004),
          },
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

      // An empty upload must actually remove the fence.
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

      // --- And MISSION_CLEAR_ALL, which is what the Clear button sends ---
      //
      // A different message from an empty upload, and it must work for all
      // three mission_types.
      await engine.uploadMission(fenceToItems(fence), 1)
      await engine.uploadMission(rallyToItems(rally), 2)
      expect(await engine.downloadMission(1)).not.toHaveLength(0)
      expect(await engine.downloadMission(2)).not.toHaveLength(0)
      for (const missionType of [0, 1, 2]) {
        await engine.clearMission(missionType)
      }
      expect(await engine.downloadMission(1)).toHaveLength(0)
      expect(await engine.downloadMission(2)).toHaveLength(0)
    } finally {
      engine.stop()
      socket?.destroy()
    }
  }, 90000)

  it('flies: guided mode, arm, takeoff to altitude, RTL (the Phase 5 gate)', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    socket = await connectVehicle(engine, events, (s) => (socket = s))

    // Copter only: ArduPlane refuses NAV_TAKEOFF in Guided by design. The
    // airframe is read from the heartbeat already received, since a second
    // connection would race the runner's relaunch.
    const hb = events.find((e) => e.t === 'heartbeat')
    if (!(hb?.t === 'heartbeat' && COPTER_TYPES.has(hb.vehicleType))) {
      engine.stop()
      socket.destroy()
      return
    }

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

      // Arm and take off as one retrying sequence. A freshly wiped SITL
      // needs an EKF position estimate before it arms, the arm ack can land
      // before the armed heartbeat, and an armed copter sitting on the ground
      // disarms itself. So rearm whenever the heartbeat says disarmed and
      // retry takeoff until accepted.
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
  }, 240000)
})
