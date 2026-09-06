// Fetch and/or run the prebuilt Windows ArduPilot SITL that Mission Planner
// uses (cygwin builds on firmware.ardupilot.org). This is the acceptance
// target for every protocol feature: the virtual FC proves our plumbing,
// SITL proves ArduPilot agrees with us.
//
//   node scripts/sitl.mjs fetch [copter|plane|rover]
//   node scripts/sitl.mjs run   [copter|plane|rover] [--home lat,lon[,alt[,yaw]]]
//
// Vehicle defaults to copter. All three share the cygwin runtime, so the
// second vehicle you fetch only pulls its own binary and defaults file.
//
// --home (or SITL_HOME in the environment) boots the vehicle somewhere other
// than CMAC -- your own flying field, so a mission planned on the map can be
// flown in the simulator without dragging every waypoint to Canberra. Taken
// at boot, so it applies to every relaunch this run makes.
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
const AUTOTEST_BASE =
  'https://raw.githubusercontent.com/ArduPilot/ardupilot/master/Tools/autotest/'
const DIR = path.resolve('sitl')

// `source` is where ArduPilot actually keeps each frame's bench defaults --
// most live in default_params/, but plane's sits under models/, which is
// the mapping vehicleinfo.json records.
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
  rover: {
    binary: 'ArduRover',
    model: 'rover',
    defaults: 'rover.parm',
    source: 'default_params/rover.parm',
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
 * One supervisor at a time.
 *
 * The quick-exit guard catches a second runner started while the first is
 * serving, because its simulator cannot bind 5760 and dies at once. It does
 * not catch the case that actually happens: this SITL exits when its client
 * disconnects, so between one connection and the next there is a window
 * where the port really is free and a second runner binds it happily. Both
 * then live, each relaunching its own simulator, and which one you reach
 * depends on who won the last race -- with `--home`, that means a healthy
 * simulator at somebody else's field.
 *
 * So the runner takes a lock rather than the port. A stale file from a
 * runner that was killed outright is ignored, which is the common case:
 * the check is whether that pid is still alive, not whether the file
 * exists.
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
    // Only ever our own claim: a runner that took over after we were
    // killed must not have its lock deleted by our exit handler.
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
const positional = argv.filter((a) => !a.startsWith('-'))

const cmd = positional[0] ?? 'run'
const name = positional[1] ?? 'copter'

const CMAC = '-35.363262,149.165237,584,270'
const home = normalizeHome(homeArg ?? process.env.SITL_HOME ?? CMAC)

/**
 * Accept the two numbers a map gives you and fill in the rest. SITL wants
 * four fields and silently misbehaves with fewer, so completing them here is
 * the difference between "--home 38.9,-77" working and booting at sea level
 * facing an arbitrary direction.
 */
function normalizeHome(text) {
  const parts = String(text).split(/[,;\s]+/).filter(Boolean).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) {
    console.error(`bad --home "${text}" -- expected decimal degrees, like 38.9034,-77.0365`)
    process.exit(1)
  }
  const [lat, lon, alt = 0, yaw = 0] = parts
  // Latitude past the poles is nearly always a swapped pair, and it is the
  // one typo that stays plausible all the way to a vehicle in the wrong sea.
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

if (cmd === 'fetch') {
  await fetchVehicle()
} else if (cmd === 'run') {
  if (!existsSync(exe)) await fetchVehicle()

  // -w wipes state so every run boots clean; the default serial0 is a TCP
  // server on 5760 that waits for the GCS. Home defaults to CMAC, like
  // sim_vehicle.py.
  //
  // This SITL build exits when its TCP client disconnects, so relaunch it
  // in a loop -- one `npm run sitl` then serves any number of sequential
  // connections (each getting a freshly-booted vehicle). Ctrl+C ends it.
  if (home !== CMAC) console.log(`${name} SITL home: ${home}`)

  const unlock = claimRunner(name)

  let stopping = false
  /** The simulator we are supervising, so a signal can actually stop it. */
  let running = null

  /**
   * Take the simulator down with us.
   *
   * Setting a flag is not enough. On Windows a Ctrl+C reaches this process
   * but not reliably the grandchild behind npm's cmd.exe wrapper, and any
   * other way of ending the runner -- a kill, an editor closing the
   * terminal -- reaches it not at all. The simulator then keeps 5760, and
   * the next run looks like a broken simulator: with --home, a second one
   * silently leaves you connected to the first, at its own location.
   *
   * SIGTERM first, then TerminateProcess if it has not gone. Node maps
   * kill() to TerminateProcess on Windows anyway, so the second one only
   * matters on POSIX -- where a simulator wedged at boot does ignore the
   * first.
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
    // SIGBREAK is Windows' Ctrl+Break, and SIGHUP is what a closing
    // terminal sends; neither is delivered by default on the other
    // platform, and listening for an undeliverable one is harmless.
    process.on(signal, shutdown)
  }
  // A crash in the supervisor must not leave a simulator behind either.
  process.on('uncaughtException', (err) => {
    console.error(err)
    shutdown()
  })
  // A SITL that dies immediately never served anyone, so relaunching it is
  // an infinite loop that looks like it is working. The most common cause is
  // another SITL already on 5760 -- which is worth naming, because with
  // --home the symptom is a healthy simulator at the *previous* location
  // rather than an error. (Checking the port first does not work: Windows
  // lets a second bind succeed over a listening socket, so the probe says
  // "free" and the guard never fires.)
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
        vehicle.defaults,
        '--home',
        home,
        // No --rate override: the default sim rate keeps the gyro sample
        // rate above the 1.8x-loop-rate arming check.
      ],
      { cwd: DIR, stdio: 'inherit' },
    )
    running = child
    child.on('exit', () => {
      if (stopping) process.exit(0)
      if (Date.now() - startedAt < MIN_USEFUL_MS && ++quickExits >= 3) {
        unlock()
        console.error(
          `${name} SITL keeps exiting at startup. Is another simulator already on 5760? ` +
            'With --home, a second one leaves you connected to the first, at its own location.',
        )
        process.exit(1)
      }
      console.log(`${name} SITL exited (client disconnected) -- relaunching`)
      // A short breather: relaunching into still-closing sockets has been
      // seen to stall the sim clock at boot.
      setTimeout(launch, 2000)
    })
  }
  launch()
}
