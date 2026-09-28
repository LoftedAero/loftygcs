// Managing a local ArduPilot SITL install: where it lives, what to fetch, and
// how to launch it. Free of Electron imports so it is testable in plain Node.
//
// Only Windows has official prebuilt SITL binaries (the cygwin builds Mission
// Planner ships). Elsewhere, users run sim_vehicle.py and connect over TCP.
import { spawn, type ChildProcess } from 'node:child_process'
// Lives in src/ because the renderer parses the same text.
import { formatHome, type SimHome } from '../src/sim-home'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import { get } from 'node:https'
import { connect } from 'node:net'
import path from 'node:path'

const BINARY_BASE = 'https://firmware.ardupilot.org/Tools/MissionPlanner/sitl/CopterStable/'
const AUTOTEST_BASE = 'https://raw.githubusercontent.com/ArduPilot/ardupilot/master/Tools/autotest/'

/** SITL's serial0 TCP server, the port a GCS attaches to. */
export const SITL_PORT = 5760

// Rover is not offered until the app supports ground vehicles. Adding it
// means `default_params/rover.parm`, the `rover` physics model and the
// `ArduRover` binary; `readBuildInfo` refuses builds with no entry here.
export type SimVehicle = 'copter' | 'plane'

interface VehicleSpec {
  label: string
  /** Basename on the firmware server (published as .elf, actually a PE exe). */
  binary: string
  /** SITL physics model. */
  model: string
  /** Bench defaults file; without it a wiped vehicle never passes prearm. */
  defaults: string
  /**
   * Path in the ArduPilot tree. Most are in default_params/, but plane's is
   * under models/ (see Tools/autotest/pysim/vehicleinfo.json).
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

/** CMAC, the field sim_vehicle.py defaults to. */
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
 * Where a running SITL keeps its state.
 *
 * ArduPilot writes eeprom.bin (the stored parameter set) into its working
 * directory. One directory per model, matching Mission Planner, so an
 * aircraft shipped as an executable beside `<model>/eeprom.bin` is found from
 * the executable alone. Any `:host` suffix is dropped, since a colon cannot
 * appear in a Windows directory name.
 */
export function simWorkDir(baseDir: string, launch: SimLaunch): string {
  const root = launch.exe ? path.dirname(launch.exe) : baseDir
  return path.join(root, modelName(launch).split(':')[0]!)
}

/** Physics: SITL's own model, or RealFlight driving it over FlightAxis. */
export type SimPhysics = { kind: 'builtin' } | { kind: 'flightaxis' }

/**
 * What the vehicle boots with. A .parm is a list of values applied over
 * defaults; an eeprom.bin is the stored set itself and replaces it whole.
 */
export type SimParams =
  | { kind: 'keep' }
  | { kind: 'wipe' }
  | { kind: 'file'; path: string }
  | { kind: 'eeprom'; path: string }

export interface SimLaunch {
  vehicle: SimVehicle
  /** A build the user supplied. Unset means the managed download. */
  exe?: string
  home?: SimHome
  physics?: SimPhysics
  params?: SimParams
}

/** Tell a parameter list from a stored-parameter image, by what it is. */
export function classifyParamFile(file: string): SimParams {
  return /\.bin$/i.test(file) ? { kind: 'eeprom', path: file } : { kind: 'file', path: file }
}

/** The --model string: the vehicle's own physics, or RealFlight's. */
export function modelName(launch: SimLaunch): string {
  const physics = launch.physics ?? { kind: 'builtin' }
  if (physics.kind === 'builtin') return SIM_VEHICLES[launch.vehicle].model
  // Bare means RealFlight on this machine. ArduPilot also accepts
  // `flightaxis:<host>`; it is not offered because almost nobody needs it.
  return 'flightaxis'
}

/** RealFlight's SOAP port and host. */
export const FLIGHTAXIS_PORT = 18083
export const FLIGHTAXIS_HOST = '127.0.0.1'

/**
 * Launch arguments.
 *
 * No `--rate` override: forcing a rate drops the gyro sample rate below the
 * arming check's 1.8x-loop-rate threshold and the vehicle never arms. The
 * defaults path is absolute because the working directory is a subdirectory.
 *
 * Stock defaults are passed only for a managed build. A custom build carries
 * its own configuration, and layering ours over it would change it.
 */
export function simArgs(baseDir: string, launch: SimLaunch): string[] {
  const home = launch.home ? formatHome(launch.home) : SIM_HOME
  const params = launch.params ?? { kind: 'wipe' }
  const defaults: string[] = []
  if (!launch.exe) defaults.push(path.join(baseDir, SIM_VEHICLES[launch.vehicle].defaults))
  if (params.kind === 'file') defaults.push(params.path)

  const args = ['--model', modelName(launch)]
  // A parameter file only sets defaults and stored values outrank it, so it
  // needs a wipe or it is silently ignored.
  if (params.kind === 'wipe' || params.kind === 'file') args.push('-w')
  if (defaults.length > 0) args.push('--defaults', defaults.join(','))
  args.push('--home', home)
  return args
}

/**
 * Process names a leftover simulator could be running under.
 *
 * A second SITL cannot bind TCP 5760, so a leftover one (from a crashed
 * session or the command line) makes every launch fail. Candidates are
 * identified by name, never by "whatever holds 5760": only the binaries this
 * app launches, plus the custom build about to be launched.
 */
export function simProcessNames(exe?: string, platform: string = process.platform): string[] {
  const suffix = platform === 'win32' ? '.exe' : ''
  const names = new Set(Object.values(SIM_VEHICLES).map((v) => v.binary + suffix))
  if (exe) names.add(path.basename(exe))
  return [...names]
}

/** ArduPilot stamps its own name and version into the binary. */
const BUILD_BANNER = /Ardu(Copter|Plane|Rover|Sub) V(\d+\.\d+\.\d+)/

export interface BuildInfo {
  vehicle: SimVehicle
  /** As the firmware reports it, e.g. "4.6.3". */
  version: string
}

/**
 * Identify a build from the version banner compiled into it. Launching one
 * vehicle against another's defaults fails like a broken simulator.
 */
export function readBuildInfo(exe: string): BuildInfo | null {
  let text: string
  try {
    text = readFileSync(exe).toString('latin1')
  } catch {
    return null
  }
  const m = BUILD_BANNER.exec(text)
  if (!m) return null
  const vehicle = m[1]!.toLowerCase()
  if (vehicle === 'copter') return { vehicle: 'copter', version: m[2]! }
  if (vehicle === 'plane') return { vehicle: 'plane', version: m[2]! }
  // ArduRover and ArduSub have no SIM_VEHICLES entry. The pattern still
  // matches them so they are recognized as ArduPilot builds rather than
  // rejected as unknown binaries.
  return null
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
          // Rename only on success, so a partial download never looks
          // installed.
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
      'The simulator download does not support this platform. Run sim_vehicle.py and use "Connect to a running simulator".',
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

/**
 * Put the vehicle's stored parameters in place before it boots.
 *
 * ArduPilot can only read eeprom.bin from its working directory, so a
 * supplied one is copied in. The original stays untouched while the working
 * copy accumulates changes.
 */
export function prepareWorkDir(workDir: string, params: SimParams): void {
  mkdirSync(workDir, { recursive: true })
  if (params.kind !== 'eeprom') return
  const dest = path.join(workDir, 'eeprom.bin')
  // Copying a file onto itself truncates it on some platforms.
  if (path.resolve(params.path) === path.resolve(dest)) return
  copyFileSync(params.path, dest)
}

export function spawnSim(baseDir: string, launch: SimLaunch): ChildProcess {
  const exe = launch.exe ?? executablePath(baseDir, launch.vehicle)
  if (!existsSync(exe)) {
    throw new Error(
      launch.exe ? `${exe} is missing` : `${exe} is missing; install the simulator first`,
    )
  }
  const params = launch.params ?? { kind: 'wipe' }
  if (params.kind === 'file' || params.kind === 'eeprom') {
    if (!existsSync(params.path)) throw new Error(`${params.path} is missing`)
  }
  const workDir = simWorkDir(baseDir, launch)
  prepareWorkDir(workDir, params)
  return spawn(exe, simArgs(baseDir, launch), { cwd: workDir, env: simEnv(baseDir, exe) })
}

/**
 * PATH with the cygwin runtime on it.
 *
 * The published SITL binaries need ten cygwin DLLs, which Windows looks for
 * beside the executable and then on PATH. Without them a custom build exits
 * immediately with status 0 and no output. Mission Planner does the same.
 * The build's own directory goes first so a self-contained build uses its
 * own runtime.
 */
export function simEnv(baseDir: string, exe: string): NodeJS.ProcessEnv {
  const parts = [path.dirname(exe), baseDir, process.env.PATH ?? '']
  return { ...process.env, PATH: parts.filter(Boolean).join(path.delimiter) }
}

/**
 * Whether anything is listening on RealFlight's port.
 *
 * SITL retries the SOAP connection indefinitely and sends no MAVLink until
 * FlightAxis is exchanging data, so without this check the user just sees a
 * timeout. A plain TCP connect is enough; if the listener is not RealFlight,
 * SITL's own error is the better one to show.
 */
export function flightAxisReachable(host = FLIGHTAXIS_HOST, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: FLIGHTAXIS_PORT })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** SITL announces its GCS port on stdout once serial0 is listening. */
export const READY_PATTERN = /Waiting for connection|SERIAL0 on TCP port/

/**
 * Resolve when SITL is ready for the GCS to attach.
 *
 * Reads stdout rather than probing the port: SITL accepts one client and
 * exits when it disconnects, so a probe would kill it.
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
