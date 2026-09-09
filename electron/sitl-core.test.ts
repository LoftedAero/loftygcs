import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createConnection } from 'node:net'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  READY_PATTERN,
  SIM_VEHICLES,
  classifyParamFile,
  executableName,
  installedVehicles,
  isInstalled,
  modelName,
  simProcessNames,
  prepareWorkDir,
  readBuildInfo,
  simArgs,
  simSupported,
  simWorkDir,
  spawnSim,
  waitForReady,
} from './sitl-core'

const BASE = path.resolve('sitl')
const args = (launch: Parameters<typeof simArgs>[1]) => simArgs(BASE, launch)
const flag = (a: string[], name: string) => a[a.indexOf(name) + 1]

describe('sitl-core', () => {
  it('knows which platforms have published binaries', () => {
    expect(simSupported('win32')).toBe(true)
    expect(simSupported('darwin')).toBe(false)
    expect(simSupported('linux')).toBe(false)
  })

  it('names executables per platform', () => {
    expect(executableName('copter', 'win32')).toBe('ArduCopter.exe')
    expect(executableName('plane', 'linux')).toBe('ArduPlane')
  })

  it('builds launch arguments that let the vehicle arm', () => {
    const a = args({ vehicle: 'copter' })
    // -w wipes stored params so a session always starts identical...
    expect(a).toContain('-w')
    // ...and the defaults file is what makes prearm pass at all.
    expect(a).toContain('--defaults')
    expect(flag(a, '--defaults')).toContain('copter.parm')
    // Absolute, because the working directory is a subdirectory now and a
    // bare filename would be looked for in the wrong place.
    expect(path.isAbsolute(flag(a, '--defaults')!)).toBe(true)
    // No --rate override: forcing one drops the gyro sample rate under the
    // arming check's threshold and the vehicle then never arms.
    expect(a).not.toContain('--rate')
    expect(a.join(' ')).toMatch(/--home -35\.363262/)
  })

  it('uses the right physics model per vehicle', () => {
    // The two differ -- a plane launched on the copter model flies like
    // nothing at all -- so this is the assertion, not the literal names.
    expect(args({ vehicle: 'plane' })).toContain(SIM_VEHICLES.plane.model)
    expect(args({ vehicle: 'copter' })).toContain(SIM_VEHICLES.copter.model)
    expect(SIM_VEHICLES.plane.model).not.toBe(SIM_VEHICLES.copter.model)
  })

  it('reports nothing installed for an empty directory', () => {
    const empty = path.join(process.cwd(), 'does-not-exist-sitl')
    expect(isInstalled(empty, 'copter')).toBe(false)
    expect(installedVehicles(empty)).toEqual([])
  })

  it('recognizes the readiness banner SITL prints', () => {
    expect(READY_PATTERN.test('bind port 5760 for SERIAL0')).toBe(false)
    expect(READY_PATTERN.test('SERIAL0 on TCP port 5760')).toBe(true)
    expect(READY_PATTERN.test('Waiting for connection ....')).toBe(true)
    expect(READY_PATTERN.test('Starting SITL input')).toBe(false)
  })
})

/** Minimal stand-in for a spawned process: stdout, stderr, and exit. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('waitForReady', () => {
  it('resolves on the readiness banner without touching the port', async () => {
    const child = fakeChild()
    const ready = waitForReady(child as unknown as ChildProcess, 2000)
    child.stdout.emit('data', Buffer.from('Starting SITL input\n'))
    child.stdout.emit('data', Buffer.from('SERIAL0 on TCP port 5760\n'))
    await expect(ready).resolves.toBeUndefined()
  })

  it('rejects if the simulator dies during startup', async () => {
    const child = fakeChild()
    const ready = waitForReady(child as unknown as ChildProcess, 2000)
    child.emit('exit')
    await expect(ready).rejects.toThrow(/exited during startup/)
  })

  it('rejects when the banner never arrives', async () => {
    const child = fakeChild()
    await expect(waitForReady(child as unknown as ChildProcess, 50)).rejects.toThrow(
      /did not report readiness/,
    )
  })
})

// Exercises the real spawn path against the checked-out simulator install
// (npm run sitl:fetch). Gated like the other SITL tests.
describe.runIf(process.env.SITL === '1')('sitl-core spawn', () => {
  let child: ChildProcess | null = null
  afterEach(() => {
    child?.kill()
    child = null
  })

  it('launches SITL and reports itself ready', async () => {
    const dir = path.resolve('sitl')
    expect(isInstalled(dir, 'copter')).toBe(true)
    child = spawnSim(dir, { vehicle: 'copter' })
    await waitForReady(child, 30000)
    // Still alive: readiness detection must not consume the one client slot.
    expect(child.killed).toBe(false)
    expect(child.exitCode).toBeNull()
  }, 45000)

  it('boots the in-app simulator at the home it was given', async () => {
    // The desktop path end to end: what the Simulator card sets reaches the
    // running vehicle. Read off stdout rather than over MAVLink, so this
    // needs neither the TCP slot nor a second simulator to be free.
    const dir = path.resolve('sitl')
    child = spawnSim(dir, {
      vehicle: 'copter',
      home: { latDeg: 51.4769, lonDeg: -0.0005, altM: 15, headingDeg: 45 },
    })
    const line = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no Home line from SITL')), 30000)
      child?.stdout?.on('data', (d: Buffer) => {
        const m = /Home: (-?[\d.]+) (-?[\d.]+)/.exec(d.toString())
        if (m) {
          clearTimeout(timer)
          resolve(m[0])
        }
      })
    })
    expect(line).toContain('51.4769')
    expect(line).toContain('-0.0005')
  }, 45000)
})

describe('choosing a build', () => {
  it('uses the managed download when no build is named', () => {
    const a = args({ vehicle: 'copter' })
    // The stock defaults are what get a downloaded vehicle through prearm.
    expect(flag(a, '--defaults')).toContain('copter.parm')
  })

  it('leaves a custom build to its own defaults', () => {
    // Layering our bench configuration over a build someone tuned would
    // quietly change their aircraft.
    const a = args({ vehicle: 'plane', exe: 'C:/rf/arduplane.exe', params: { kind: 'keep' } })
    expect(a).not.toContain('--defaults')
  })

  it('reads the vehicle and version out of a binary', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sitl-build-'))
    const exe = path.join(dir, 'arduplane.exe')
    // A stand-in for the banner ArduPilot stamps into every build, sitting
    // in binary noise the way the real one does.
    writeFileSync(
      exe,
      Buffer.concat([
        Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0xff, 0xfe]),
        Buffer.from('ArduPlane V4.6.3 (03037e3a)'),
        Buffer.from([0x00, 0x01, 0x02]),
      ]),
    )
    expect(readBuildInfo(exe)).toEqual({ vehicle: 'plane', version: '4.6.3' })
  })

  it('says nothing rather than guessing at an unfamiliar binary', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sitl-build-'))
    const notSitl = path.join(dir, 'notepad.exe')
    writeFileSync(notSitl, 'this is not a flight controller')
    expect(readBuildInfo(notSitl)).toBeNull()
    expect(readBuildInfo(path.join(dir, 'absent.exe'))).toBeNull()
    // ArduSub has no entry to launch it as, so it is not a build we can use.
    const sub = path.join(dir, 'ardusub.exe')
    writeFileSync(sub, 'ArduSub V4.5.0 (deadbeef)')
    expect(readBuildInfo(sub)).toBeNull()
  })
})

// Against the real published binaries rather than a fixture we wrote: a
// banner scanner tested only on its own test data proves the scanner reads
// what the test author believed ArduPilot writes.
describe.runIf(existsSync(path.join(BASE, executableName('copter'))))('reading real builds', () => {
  it('identifies the downloaded simulators', () => {
    const copter = readBuildInfo(path.join(BASE, executableName('copter')))
    expect(copter?.vehicle).toBe('copter')
    expect(copter?.version).toMatch(/^\d+\.\d+\.\d+$/)
    const plane = readBuildInfo(path.join(BASE, executableName('plane')))
    expect(plane?.vehicle).toBe('plane')
  })
})

describe('what the vehicle boots with', () => {
  it('wipes by default, so a session always starts the same', () => {
    expect(args({ vehicle: 'copter' })).toContain('-w')
    expect(args({ vehicle: 'copter', params: { kind: 'wipe' } })).toContain('-w')
  })

  it('keeps stored parameters when asked to', () => {
    // Tuning wants the parameters it left behind; wiping them every launch
    // is why this stopped being unconditional.
    expect(args({ vehicle: 'copter', params: { kind: 'keep' } })).not.toContain('-w')
  })

  it('wipes alongside a parameter file, or the file does nothing', () => {
    const a = args({ vehicle: 'copter', params: { kind: 'file', path: 'C:/my.parm' } })
    // --defaults only sets defaults, and a stored value outranks a default,
    // so without the wipe the file is read and then silently ignored.
    expect(a).toContain('-w')
    expect(flag(a, '--defaults')).toBe(path.join(BASE, 'copter.parm') + ',C:/my.parm')
  })

  it('does not wipe an EEPROM it was just handed', () => {
    // The image *is* the stored set; wiping would erase what was loaded.
    const a = args({ vehicle: 'copter', params: { kind: 'eeprom', path: 'C:/eeprom.bin' } })
    expect(a).not.toContain('-w')
  })

  it('tells a parameter list from a stored image by what it is', () => {
    expect(classifyParamFile('C:/x/eeprom.bin')).toEqual({
      kind: 'eeprom',
      path: 'C:/x/eeprom.bin',
    })
    expect(classifyParamFile('C:/x/f35.parm')).toEqual({ kind: 'file', path: 'C:/x/f35.parm' })
    expect(classifyParamFile('C:/x/f35.param')).toEqual({ kind: 'file', path: 'C:/x/f35.param' })
  })

  it('copies a chosen EEPROM into the working directory', () => {
    // ArduPilot has no option to read storage from elsewhere: it opens
    // eeprom.bin in the directory it was started in.
    const dir = mkdtempSync(path.join(tmpdir(), 'sitl-eeprom-'))
    const src = path.join(dir, 'shipped.bin')
    writeFileSync(src, 'PA-stored-parameters')
    const work = path.join(dir, 'flightaxis')
    prepareWorkDir(work, { kind: 'eeprom', path: src })
    expect(readFileSync(path.join(work, 'eeprom.bin')).toString()).toBe('PA-stored-parameters')
  })

  it('survives being handed the EEPROM already in place', () => {
    // Picking the working directory's own eeprom.bin is the obvious way to
    // reach this, and a copy onto itself truncates the file.
    const dir = mkdtempSync(path.join(tmpdir(), 'sitl-eeprom-'))
    const work = path.join(dir, 'flightaxis')
    mkdirSync(work, { recursive: true })
    const inPlace = path.join(work, 'eeprom.bin')
    writeFileSync(inPlace, 'PA-stored-parameters')
    prepareWorkDir(work, { kind: 'eeprom', path: inPlace })
    expect(readFileSync(inPlace).toString()).toBe('PA-stored-parameters')
  })
})

describe('RealFlight', () => {
  it('hands SITL the flightaxis model instead of its own physics', () => {
    const a = args({ vehicle: 'plane', physics: { kind: 'flightaxis' } })
    expect(flag(a, '--model')).toBe('flightaxis')
  })

  it('names only simulators it could have launched, for the stray killer', () => {
    // This list is handed to taskkill/pkill, so what is *not* in it matters
    // more than what is: "whatever holds 5760" would be an unidentified
    // process on someone's machine, and the app has no business killing it.
    const win = simProcessNames(undefined, 'win32')
    expect(win).toEqual(['ArduCopter.exe', 'ArduPlane.exe'])
    expect(simProcessNames(undefined, 'linux')).toEqual(['ArduCopter', 'ArduPlane'])

    // A custom build joins the set, by basename -- a full path would be
    // handed to taskkill as an image name and match nothing.
    const custom = simProcessNames('C:/builds/f35b/ArduPlane.exe', 'win32')
    expect(custom).toContain('ArduPlane.exe')
    expect(custom.every((n) => n === path.basename(n))).toBe(true)
    // And it does not appear twice when it shares a name with a managed one.
    expect(custom.filter((n) => n === 'ArduPlane.exe')).toHaveLength(1)

    const other = simProcessNames('C:/builds/Custom.exe', 'win32')
    expect(other).toContain('Custom.exe')
    expect(other).toHaveLength(3)
  })

  it('names RealFlight without an address, which means this machine', () => {
    // ArduPilot also accepts `flightaxis:<host>` for a copy running across
    // a network, and the app no longer offers it -- so the model string is
    // always bare, and spelling out 127.0.0.1 would only be noise in the
    // argument list.
    expect(modelName({ vehicle: 'plane', physics: { kind: 'flightaxis' } })).toBe('flightaxis')
  })

  it('keeps each model its own stored parameters, beside the build', () => {
    // This is the layout an aircraft ships in: the executable, and a
    // <model>/eeprom.bin next to it. Pointing at the executable has to find
    // the parameters with no further instruction.
    const launch = {
      vehicle: 'plane' as const,
      exe: path.join('C:', 'rf', 'arduplane.exe'),
      physics: { kind: 'flightaxis' as const, host: '192.168.1.5' },
    }
    expect(simWorkDir(BASE, launch)).toBe(path.join('C:', 'rf', 'flightaxis'))
  })

  it('keeps the managed install state under it, not beside the exe', () => {
    expect(simWorkDir(BASE, { vehicle: 'copter' })).toBe(path.join(BASE, '+'))
    expect(simWorkDir(BASE, { vehicle: 'plane' })).toBe(path.join(BASE, 'plane'))
  })
})

// The launch choices, driven through the real simulator. A launch path is
// exactly the kind of thing that type-checks and then does nothing:
// --defaults can name a file that is never read, and a custom build can
// exit silently because a DLL is missing. Only running one settles it.
//
// The probe throughout is SERIAL0_PROTOCOL -1, which switches MAVLink off.
// It was chosen after SYSID_THISMAV turned out not to reach the heartbeat,
// making a test that could not fail: "did a heartbeat arrive" is binary,
// needs no MAVLink parsing, and cannot be true for the wrong reason.
describe.runIf(process.env.SITL === '1')('launching the real simulator', () => {
  const dir = path.resolve('sitl')
  let child: ChildProcess | null = null
  afterEach(async () => {
    child?.kill()
    child = null
    // SITL holds port 5760 and does not release it the instant it is
    // killed; a shorter wait had the next launch's client attach to the
    // dying process and sit there hearing nothing.
    await new Promise((r) => setTimeout(r, 2000))
  })

  /** Does a vehicle launched this way talk MAVLink at all? */
  const heartbeats = async (launch: Parameters<typeof spawnSim>[1]) => {
    child = spawnSim(dir, launch)
    await waitForReady(child, 30000)
    return await new Promise<boolean>((resolve) => {
      const sock = createConnection({ host: '127.0.0.1', port: 5760 })
      const timer = setTimeout(() => {
        sock.destroy()
        resolve(false)
      }, 8000)
      sock.on('data', (d: Buffer) => {
        // Any MAVLink frame will do; this is a "is the port alive" question.
        if (d.includes(0xfd) || d.includes(0xfe)) {
          clearTimeout(timer)
          sock.destroy()
          resolve(true)
        }
      })
      sock.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  it('reads the defaults file at the absolute path it is given', async () => {
    // The working directory is a subdirectory now, so --defaults became an
    // absolute path. If SITL quietly failed to open it -- and it prints
    // nothing either way, even for a file that does not exist -- every
    // vehicle would launch without the configuration that gets it armed.
    const off = path.join(mkdtempSync(path.join(tmpdir(), 'sitl-def-')), 'off.parm')
    writeFileSync(off, 'SERIAL0_PROTOCOL -1\n')
    expect(await heartbeats({ vehicle: 'copter', params: { kind: 'file', path: off } })).toBe(false)
  }, 60000)

  it('talks MAVLink when nothing switched it off', async () => {
    // The control for the test above: without it, "no heartbeat" would be
    // just as consistent with a simulator that never started.
    expect(await heartbeats({ vehicle: 'copter', params: { kind: 'wipe' } })).toBe(true)
  }, 60000)

  it('boots from an EEPROM handed to it, in its own directory', async () => {
    const src = path.join(mkdtempSync(path.join(tmpdir(), 'sitl-ship-')), 'eeprom.bin')
    const work = simWorkDir(dir, { vehicle: 'copter' })
    mkdirSync(work, { recursive: true })
    await heartbeats({ vehicle: 'copter', params: { kind: 'wipe' } })
    child?.kill()
    child = null
    await new Promise((r) => setTimeout(r, 2000))
    copyFileSync(path.join(work, 'eeprom.bin'), src)

    const shipped = readFileSync(src)
    expect(await heartbeats({ vehicle: 'copter', params: { kind: 'eeprom', path: src } })).toBe(
      true,
    )
    // The image was copied in rather than opened in place, so the file the
    // aircraft was distributed as is still byte-for-byte what it was. The
    // working copy is *not*, and must not be: SITL writes storage back as
    // it runs, and that is the whole reason for copying.
    expect(readFileSync(src).equals(shipped)).toBe(true)
    expect(readFileSync(path.join(work, 'eeprom.bin')).equals(shipped)).toBe(false)
  }, 90000)

  it('starts on flightaxis with no RealFlight listening', async () => {
    // This is why the app no longer refuses to launch without RealFlight.
    // The simulator comes up, binds its GCS port and announces itself in
    // milliseconds; ArduPilot's socket_creator thread then retries the SOAP
    // connection for as long as the process runs, so starting RealFlight
    // afterwards is a supported order.
    let out = ''
    const proc = spawnSim(dir, { vehicle: 'plane', physics: { kind: 'flightaxis' } })
    child = proc
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    await waitForReady(proc, 20000)
    expect(out).not.toMatch(/You must specify a vehicle model/)
    expect(proc.exitCode).toBeNull()
  }, 30000)

  it('accepts a GCS but says nothing until RealFlight is there', async () => {
    // The other half, and the reason the launch still warns. A GCS attaches
    // to a port that answers nothing, because the vehicle's update() returns
    // early with no sample -- so "connected, no heartbeat" is the symptom,
    // and it does not point at RealFlight on its own.
    child = spawnSim(dir, { vehicle: 'plane', physics: { kind: 'flightaxis' } })
    await waitForReady(child, 20000)
    const beat = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ host: '127.0.0.1', port: 5760 })
      const timer = setTimeout(() => {
        sock.destroy()
        resolve(false)
      }, 8000)
      sock.on('data', (d: Buffer) => {
        if (d.includes(0xfd) || d.includes(0xfe)) {
          clearTimeout(timer)
          sock.destroy()
          resolve(true)
        }
      })
      sock.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    expect(beat).toBe(false)
  }, 40000)
})

// A build from outside the managed install, which is the case the PATH
// handling exists for: the published binaries are cygwin builds that need
// ten DLLs, and one that cannot find them exits with status 0 and no output.
describe.runIf(process.env.SITL_CUSTOM_EXE !== undefined)('a custom build', () => {
  let child: ChildProcess | null = null
  afterEach(async () => {
    child?.kill()
    child = null
    await new Promise((r) => setTimeout(r, 1200))
  })

  it('launches from wherever it lives and reports itself ready', async () => {
    const exe = process.env.SITL_CUSTOM_EXE!
    const info = readBuildInfo(exe)
    expect(info).not.toBeNull()
    child = spawnSim(path.resolve('sitl'), {
      vehicle: info!.vehicle,
      exe,
      params: { kind: 'keep' },
    })
    await waitForReady(child, 30000)
    expect(child.exitCode).toBeNull()
  }, 45000)
})

describe('simArgs with a home', () => {
  it('passes the location through to --home', () => {
    const a = args({
      vehicle: 'copter',
      home: { latDeg: 51.5, lonDeg: -0.12, altM: 20, headingDeg: 90 },
    })
    expect(flag(a, '--home')).toBe('51.5,-0.12,20,90')
  })
})
