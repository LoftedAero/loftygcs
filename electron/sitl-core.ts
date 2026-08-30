// Managing a local ArduPilot SITL install: where it lives, what to fetch,
// and how to launch it. Kept free of Electron imports so the whole flow is
// testable in plain Node -- the same reason src/protocol is.
//
// Only Windows has official prebuilt SITL binaries (the cygwin builds
// Mission Planner ships). Everywhere else, users run their own
// sim_vehicle.py and the app connects to it over TCP like any other link.
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { get } from 'node:https'
import path from 'node:path'

const BINARY_BASE = 'https://firmware.ardupilot.org/Tools/MissionPlanner/sitl/CopterStable/'
const AUTOTEST_BASE = 'https://raw.githubusercontent.com/ArduPilot/ardupilot/master/Tools/autotest/'

/** SITL's serial0 TCP server, the port a GCS attaches to. */
export const SITL_PORT = 5760

export type SimVehicle = 'copter' | 'plane' | 'rover'

interface VehicleSpec {
  label: string
  /** Basename on the firmware server (published as .elf, actually a PE exe). */
  binary: string
  /** SITL physics model. */
  model: string
  /** Bench defaults file; without it a wiped vehicle never passes prearm. */
  defaults: string
  /**
   * Where that file lives in the ArduPilot tree. Most frames keep theirs in
   * default_params/, but plane's is under models/ -- the mapping
   * Tools/autotest/pysim/vehicleinfo.json records.
   */
  source: string
}

export const SIM_VEHICLES: Record<SimVehicle, VehicleSpec> = {
  copter: {
    label: 'Copter',
    binary: 'ArduCopter',
    model: '+',
    defaults: 'copter.parm',
    source: 'default_params/copter.parm',
  },
  plane: {
    label: 'Plane',
    binary: 'ArduPlane',
    model: 'plane',
    defaults: 'plane.parm',
    source: 'models/plane.parm',
  },
  rover: {
    label: 'Rover',
    binary: 'ArduRover',
    model: 'rover',
    defaults: 'rover.parm',
    source: 'default_params/rover.parm',
  },
}

// The cygwin runtime the published binaries link against.
const SUPPORT_DLLS = [
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

/** CMAC, the field sim_vehicle.py defaults to -- familiar to ArduPilot users. */
export const SIM_HOME = '-35.363262,149.165237,584,270'

export function simSupported(platform: string = process.platform): boolean {
  return platform === 'win32'
}

export function executableName(vehicle: SimVehicle, platform: string = process.platform): string {
  return SIM_VEHICLES[vehicle].binary + (platform === 'win32' ? '.exe' : '')
}

export function executablePath(baseDir: string, vehicle: SimVehicle): string {
  return path.join(baseDir, executableName(vehicle))
}

export function isInstalled(baseDir: string, vehicle: SimVehicle): boolean {
  return (
    existsSync(executablePath(baseDir, vehicle)) &&
    existsSync(path.join(baseDir, SIM_VEHICLES[vehicle].defaults))
  )
}

export function installedVehicles(baseDir: string): SimVehicle[] {
  return (Object.keys(SIM_VEHICLES) as SimVehicle[]).filter((v) => isInstalled(baseDir, v))
}

/**
 * Launch arguments. Two choices worth their comments: `-w` wipes stored
 * parameters so every session starts from the same known vehicle, and no
 * `--rate` override is passed -- forcing a rate drops the gyro sample rate
 * below the arming check's 1.8x-loop-rate threshold and the vehicle then
 * refuses to arm forever.
 */
export function simArgs(vehicle: SimVehicle, home: string = SIM_HOME): string[] {
  return ['--model', SIM_VEHICLES[vehicle].model, '-w', '--defaults', SIM_VEHICLES[vehicle].defaults, '--home', home]
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const next = res.headers.location
        if (!next) return reject(new Error(`redirect without location: ${url}`))
        return download(next, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`))
      const tmp = dest + '.part'
      const out = createWriteStream(tmp)
      res.pipe(out)
      out.on('error', reject)
      out.on('finish', () => {
        out.close(() => {
          // Rename only on success, so an interrupted download never leaves
          // a half file that looks installed.
          renameSync(tmp, dest)
          resolve()
        })
      })
    }).on('error', reject)
  })
}

export interface InstallProgress {
  file: string
  done: number
  total: number
}

/** Fetch one vehicle's binary, the cygwin runtime, and its defaults file. */
export async function installVehicle(
  baseDir: string,
  vehicle: SimVehicle,
  onProgress?: (p: InstallProgress) => void,
): Promise<void> {
  if (!simSupported()) {
    throw new Error(
      'Prebuilt ArduPilot SITL binaries are published for Windows only. On macOS and Linux, run sim_vehicle.py yourself and use "Connect to a running simulator".',
    )
  }
  mkdirSync(baseDir, { recursive: true })
  const spec = SIM_VEHICLES[vehicle]
  const jobs: { url: string; dest: string; name: string }[] = [
    {
      url: BINARY_BASE + spec.binary + '.elf',
      dest: executablePath(baseDir, vehicle),
      name: spec.binary,
    },
    ...SUPPORT_DLLS.map((d) => ({ url: BINARY_BASE + d, dest: path.join(baseDir, d), name: d })),
    {
      url: AUTOTEST_BASE + spec.source,
      dest: path.join(baseDir, spec.defaults),
      name: spec.defaults,
    },
  ]
  let done = 0
  for (const job of jobs) {
    onProgress?.({ file: job.name, done, total: jobs.length })
    if (!existsSync(job.dest)) await download(job.url, job.dest)
    done++
  }
  onProgress?.({ file: 'done', done, total: jobs.length })
}

export function spawnSim(baseDir: string, vehicle: SimVehicle): ChildProcess {
  const exe = executablePath(baseDir, vehicle)
  if (!existsSync(exe)) throw new Error(`${exe} is missing; install the simulator first`)
  return spawn(exe, simArgs(vehicle), { cwd: baseDir })
}

/** SITL announces its GCS port on stdout once serial0 is listening. */
export const READY_PATTERN = /Waiting for connection|SERIAL0 on TCP port/

/**
 * Resolve when SITL is ready for the GCS to attach.
 *
 * Deliberately reads stdout rather than probing the port: SITL accepts
 * exactly one client and exits the moment that client disconnects, so a
 * connect-and-drop readiness check kills the very process it is waiting for.
 */
export function waitForReady(child: ChildProcess, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      child.off('exit', onExit)
      if (err) reject(err)
      else resolve()
    }
    const onData = (chunk: Buffer) => {
      if (READY_PATTERN.test(chunk.toString())) finish()
    }
    const onExit = () => finish(new Error('simulator exited during startup'))
    const timer = setTimeout(
      () => finish(new Error('simulator did not report readiness')),
      timeoutMs,
    )
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', onExit)
  })
}
