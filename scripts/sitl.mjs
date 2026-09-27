// Fetch and/or run the prebuilt Windows ArduPilot SITL that Mission Planner
// uses (cygwin builds on firmware.ardupilot.org).
//
//   node scripts/sitl.mjs fetch [copter|plane]
//   node scripts/sitl.mjs run   [copter|plane] [--home lat,lon[,alt[,yaw]]] [--adsb [count]]
//
// Vehicle defaults to copter. The vehicles share the cygwin runtime, so a
// second fetch only pulls its own binary and defaults file.
//
// --home (or SITL_HOME) boots the vehicle somewhere other than CMAC. It is
// read at boot and applies to every relaunch this run makes.
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { get } from 'node:https'
import path from 'node:path'

const BASE = 'https://firmware.ardupilot.org/Tools/MissionPlanner/sitl/CopterStable/'
const AUTOTEST_BASE = 'https://raw.githubusercontent.com/ArduPilot/ardupilot/master/Tools/autotest/'
const DIR = path.resolve('sitl')

// `source` is where ArduPilot keeps each frame's bench defaults (per
// vehicleinfo.json): most are in default_params/, plane's is under models/.
const VEHICLES = {
  copter: {
    binary: 'ArduCopter',
    model: '+',
    defaults: 'copter.parm',
    source: 'default_params/copter.parm',
  },
  plane: {
    binary: 'ArduPlane',
    model: 'plane',
    defaults: 'plane.parm',
    source: 'models/plane.parm',
  },
}

// The cygwin runtime the published binaries link against; shared by all.
const RUNTIME = [
  'cygatomic-1.dll',
  'cyggcc_s-1.dll',
  'cyggcc_s-seh-1.dll',
  'cyggomp-1.dll',
  'cygiconv-2.dll',
  'cygintl-8.dll',
  'cygquadmath-0.dll',
  'cygssp-0.dll',
  'cygstdc++-6.dll',
  'cygwin1.dll',
]

/**
 * One supervisor at a time. SITL exits when its client disconnects, so
 * between connections port 5760 is genuinely free and a second runner could
 * bind it; both would then keep relaunching simulators. A lock file prevents
 * that. A lock whose pid is no longer alive is ignored.
 */
function claimRunner(name) {
  const lockFile = path.join(DIR, '.runner.pid')
  const held = readPid(lockFile)
  if (held !== null && held !== process.pid && isAlive(held)) {
    console.error(
      `Another ${name} SITL runner is already going (pid ${held}).\n` +
        'Stop it first, or talk to the one it is already serving on 5760.',
    )
    process.exit(1)
  }
  writeFileSync(lockFile, String(process.pid))
  let released = false
  const release = () => {
    if (released) return
    released = true
    // Only remove our own lock, never one a later runner took over.
    if (readPid(lockFile) === process.pid) rmSync(lockFile, { force: true })
  }
  process.on('exit', release)
  return release
}

function readPid(file) {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Signal 0 tests for existence without touching the process. */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists and belongs to someone else, which still counts.
    return err?.code === 'EPERM'
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const next = res.headers.location
        if (!next) return reject(new Error(`redirect without location: ${url}`))
        return download(next, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`))
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
    }).on('error', reject)
  })
}

const argv = process.argv.slice(2)
const homeFlag = argv.indexOf('--home')
const homeArg = homeFlag >= 0 ? argv.splice(homeFlag, 2)[1] : undefined
const adsbFlag = argv.indexOf('--adsb')
const adsbArg = adsbFlag >= 0 ? (argv.splice(adsbFlag, 2)[1] ?? '4') : undefined
const positional = argv.filter((a) => !a.startsWith('-'))

const cmd = positional[0] ?? 'run'
const name = positional[1] ?? 'copter'

const CMAC = '-35.363262,149.165237,584,270'
const home = normalizeHome(homeArg ?? process.env.SITL_HOME ?? CMAC)

/**
 * Accept lat,lon and fill in altitude and yaw. SITL wants all four fields and
 * silently misbehaves with fewer.
 */
function normalizeHome(text) {
  const parts = String(text)
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) {
    console.error(`bad --home "${text}" -- expected decimal degrees, like 38.9034,-77.0365`)
    process.exit(1)
  }
  const [lat, lon, alt = 0, yaw = 0] = parts
  // A latitude past the poles is nearly always a swapped pair.
  if (Math.abs(lat) > 90) {
    console.error(`bad --home "${text}" -- latitude ${lat} is out of range; are they swapped?`)
    process.exit(1)
  }
  if (Math.abs(lon) > 180) {
    console.error(`bad --home "${text}" -- longitude ${lon} is out of range`)
    process.exit(1)
  }
  return [lat, lon, alt, yaw].join(',')
}
const vehicle = VEHICLES[name]
if (!vehicle) {
  console.error(`unknown vehicle "${name}" -- expected ${Object.keys(VEHICLES).join(', ')}`)
  process.exit(1)
}
const exe = path.join(DIR, `${vehicle.binary}.exe`)

async function fetchVehicle() {
  mkdirSync(DIR, { recursive: true })
  for (const f of RUNTIME) {
    if (existsSync(path.join(DIR, f))) continue
    console.log(`fetching ${f}`)
    await download(BASE + f, path.join(DIR, f))
  }
  if (!existsSync(exe)) {
    console.log(`fetching ${vehicle.binary}`)
    // Published as .elf, but it is a Windows PE executable.
    await download(BASE + `${vehicle.binary}.elf`, `${exe}.part`)
    renameSync(`${exe}.part`, exe)
  }
  const defaults = path.join(DIR, vehicle.defaults)
  if (!existsSync(defaults)) {
    // The bench defaults sim_vehicle.py always loads: without them a wiped
    // SITL fails prearm forever ("RC not calibrated", no accel cal).
    console.log(`fetching ${vehicle.defaults}`)
    await download(AUTOTEST_BASE + vehicle.source, defaults)
  }

  console.log(`${name} SITL ready in sitl/`)
}

/**
 * Defaults for simulated ADS-B traffic. This has to be a launch option:
 * `--serial5 sim:adsb` attaches the simulated transponder receiver, and
 * SERIAL5_PROTOCOL is only read at boot, so setting these over MAVLink
 * produces no traffic.
 *
 * Passed as a second `--defaults` file (ArduPilot accepts a comma-separated
 * list) so the bench defaults from ArduPilot's autotest tree stay untouched.
 */
function adsbDefaults(count) {
  const file = path.join(DIR, 'adsb.parm')
  const lines = [
    '# Written by scripts/sitl.mjs --adsb. Safe to delete.',
    'SERIAL5_PROTOCOL 2',
    'ADSB_TYPE 1',
    `SIM_ADSB_COUNT ${count}`,
    '# Close enough to see at a field, high enough to read as traffic.',
    'SIM_ADSB_RADIUS 3000',
    'SIM_ADSB_ALT 300',
  ]
  writeFileSync(file, lines.join('\n') + '\n')
  return path.basename(file)
}

if (cmd === 'fetch') {
  await fetchVehicle()
} else if (cmd === 'run') {
  if (!existsSync(exe)) await fetchVehicle()

  // -w wipes state so every run boots clean; serial0 is a TCP server on 5760
  // that waits for the GCS. Home defaults to CMAC, like sim_vehicle.py.
  //
  // This SITL build exits when its TCP client disconnects, so it is
  // relaunched in a loop and serves any number of sequential connections,
  // each with a freshly booted vehicle. Ctrl+C ends it.
  if (home !== CMAC) console.log(`${name} SITL home: ${home}`)
  if (adsbArg !== undefined) console.log(`${name} SITL with ${adsbArg} ADS-B aircraft`)

  const unlock = claimRunner(name)

  let stopping = false
  /** The simulator we are supervising, so a signal can actually stop it. */
  let running = null

  /**
   * Take the simulator down with us. On Windows a Ctrl+C does not reliably
   * reach the grandchild behind npm's cmd.exe wrapper, and other ways of
   * ending the runner do not reach it at all, leaving it holding 5760.
   *
   * SIGTERM first, then SIGKILL. Node maps kill() to TerminateProcess on
   * Windows anyway; the second signal matters on POSIX, where a simulator
   * wedged at boot can ignore the first.
   */
  const shutdown = () => {
    stopping = true
    const child = running
    running = null
    unlock()
    if (!child || child.exitCode !== null) process.exit(0)
    const hard = setTimeout(() => child.kill('SIGKILL'), 2000)
    child.on('exit', () => {
      clearTimeout(hard)
      process.exit(0)
    })
    child.kill()
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    // SIGBREAK is Windows' Ctrl+Break; SIGHUP is a closing terminal.
    // Listening for one a platform never delivers is harmless.
    process.on(signal, shutdown)
  }
  // A crash in the supervisor must not leave a simulator behind either.
  process.on('uncaughtException', (err) => {
    console.error(err)
    shutdown()
  })
  // A SITL that dies immediately would otherwise relaunch forever. The usual
  // cause is another simulator already on 5760. Probing the port first does
  // not work: Windows lets a second bind succeed over a listening socket.
  const MIN_USEFUL_MS = 5000
  let quickExits = 0

  const launch = () => {
    const startedAt = Date.now()
    const child = spawn(
      exe,
      [
        '--model',
        vehicle.model,
        '-w',
        '--defaults',
        adsbArg === undefined ? vehicle.defaults : `${vehicle.defaults},${adsbDefaults(adsbArg)}`,
        '--home',
        home,
        // The simulator's own transponder receiver, on the serial port those
        // defaults point ADSB_TYPE at.
        ...(adsbArg === undefined ? [] : ['--serial5', 'sim:adsb']),
        // No --rate override: the default sim rate keeps the gyro sample
        // rate above the 1.8x-loop-rate arming check.
      ],
      { cwd: DIR, stdio: 'inherit' },
    )
    running = child
    child.on('exit', () => {
      if (stopping) process.exit(0)
      // Count consecutive quick exits only; short sessions scattered across
      // a long test run are normal.
      if (Date.now() - startedAt >= MIN_USEFUL_MS) quickExits = 0
      else if (++quickExits >= 3) {
        unlock()
        console.error(
          `${name} SITL keeps exiting at startup. Is another simulator already on 5760? ` +
            'With --home, a second one leaves you connected to the first, at its own location.',
        )
        process.exit(1)
      }
      console.log(`${name} SITL exited (client disconnected) -- relaunching`)
      // Relaunching into still-closing sockets can stall the sim clock at boot.
      setTimeout(launch, 2000)
    })
  }
  launch()
}
