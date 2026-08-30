// Fetch and/or run the prebuilt Windows ArduPilot SITL that Mission Planner
// uses (cygwin builds on firmware.ardupilot.org). This is the acceptance
// target for every protocol feature: the virtual FC proves our plumbing,
// SITL proves ArduPilot agrees with us.
//
//   node scripts/sitl.mjs fetch [copter|plane|rover]
//   node scripts/sitl.mjs run   [copter|plane|rover]
//
// Vehicle defaults to copter. All three share the cygwin runtime, so the
// second vehicle you fetch only pulls its own binary and defaults file.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream, renameSync } from 'node:fs'
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

const cmd = process.argv[2] ?? 'run'
const name = process.argv[3] ?? 'copter'
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
  // server on 5760 that waits for the GCS. CMAC home, like sim_vehicle.py.
  //
  // This SITL build exits when its TCP client disconnects, so relaunch it
  // in a loop -- one `npm run sitl` then serves any number of sequential
  // connections (each getting a freshly-booted vehicle). Ctrl+C ends it.
  let stopping = false
  process.on('SIGINT', () => {
    stopping = true
  })
  const launch = () => {
    const child = spawn(
      exe,
      [
        '--model',
        vehicle.model,
        '-w',
        '--defaults',
        vehicle.defaults,
        '--home',
        '-35.363262,149.165237,584,270',
        // No --rate override: the default sim rate keeps the gyro sample
        // rate above the 1.8x-loop-rate arming check.
      ],
      { cwd: DIR, stdio: 'inherit' },
    )
    child.on('exit', () => {
      if (stopping) process.exit(0)
      console.log(`${name} SITL exited (client disconnected) -- relaunching`)
      // A short breather: relaunching into still-closing sockets has been
      // seen to stall the sim clock at boot.
      setTimeout(launch, 2000)
    })
  }
  launch()
}
