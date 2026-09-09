// Managing a local ArduPilot SITL install: where it lives, what to fetch,
// and how to launch it. Kept free of Electron imports so the whole flow is
// testable in plain Node -- the same reason src/protocol is.
//
// Only Windows has official prebuilt SITL binaries (the cygwin builds
// Mission Planner ships). Everywhere else, users run their own
// sim_vehicle.py and the app connects to it over TCP like any other link.
import { spawn, type ChildProcess } from 'node:child_process'
// Shared with the renderer, which cannot import from electron/: the parser
// has to run on both sides -- in the settings field that accepts the text,
// and here where the argument is built.
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

// Rover is deliberately absent: whether this app supports ground vehicles
// at all is undecided, and a simulator for one nothing else in the app has
// been tested against is a feature that only looks supported. Its entry is
// four lines when that decision is made -- `default_params/rover.parm`, the
// `rover` physics model, the `ArduRover` binary -- and `readBuildInfo`
// already refuses to launch a build it has no entry for.
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
 * Where a running SITL keeps its state.
 *
 * ArduPilot writes eeprom.bin -- the whole stored parameter set -- into its
 * working directory, so the working directory *is* the vehicle's identity
 * between runs. One per model, which is Mission Planner's convention and
 * worth matching exactly: a build shipped as "here is my aircraft" is a
 * folder holding the executable beside a `<model>/eeprom.bin`, and pointing
 * at the executable then finds the parameters with no further instruction.
 *
 * The host is deliberately dropped from the name. `flightaxis:192.168.1.5`
 * cannot be a directory on Windows, and a RealFlight aircraft is the same
 * aircraft whichever machine is drawing it.
 */
export function simWorkDir(baseDir: string, launch: SimLaunch): string {
  const root = launch.exe ? path.dirname(launch.exe) : baseDir
  return path.join(root, modelName(launch).split(':')[0]!)
}

/** Physics: SITL's own model, or RealFlight driving it over FlightAxis. */
export type SimPhysics = { kind: 'builtin' } | { kind: 'flightaxis' }

/**
 * What the vehicle boots with.
 *
 * Three real choices, because "start clean" and "carry on from last time"
 * are both right depending on what you are doing -- tuning wants the
 * parameters it left behind, reproducing a bug wants them gone. The file
 * kinds are separate rather than one "load from disk" because they are not
 * the same act: a .parm is a list of values applied over defaults, an
 * eeprom.bin *is* the stored set and replaces it whole.
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
  // Bare, which FlightAxis reads as the copy of RealFlight on this machine.
  // ArduPilot also accepts `flightaxis:<host>` to drive one across a
  // network, and this app deliberately does not offer it: it cost every
  // user a field to look at for a case almost nobody has, and RealFlight on
  // another machine is a thing to add back on request rather than to keep
  // on screen forever.
  return 'flightaxis'
}

/** RealFlight's SOAP port, and the machine it now always runs on. */
export const FLIGHTAXIS_PORT = 18083
export const FLIGHTAXIS_HOST = '127.0.0.1'

/**
 * Launch arguments.
 *
 * Two choices worth their comments: no `--rate` override is passed --
 * forcing a rate drops the gyro sample rate below the arming check's
 * 1.8x-loop-rate threshold and the vehicle then refuses to arm forever --
 * and the defaults file is given as an absolute path, because the working
 * directory is now a subdirectory and a relative name would miss it.
 *
 * The stock defaults ride along for a managed build and not a custom one.
 * They are the bench configuration that gets a downloaded vehicle through
 * prearm; a build someone assembled themselves already carries its own, and
 * layering ours over it would quietly change an aircraft they tuned.
 */
export function simArgs(baseDir: string, launch: SimLaunch): string[] {
  const home = launch.home ? formatHome(launch.home) : SIM_HOME
  const params = launch.params ?? { kind: 'wipe' }
  const defaults: string[] = []
  if (!launch.exe) defaults.push(path.join(baseDir, SIM_VEHICLES[launch.vehicle].defaults))
  if (params.kind === 'file') defaults.push(params.path)

  const args = ['--model', modelName(launch)]
  // A parameter file is only a default, so stored values outrank it -- it
  // has to arrive with a wipe or it silently does nothing.
  if (params.kind === 'wipe' || params.kind === 'file') args.push('-w')
  if (defaults.length > 0) args.push('--defaults', defaults.join(','))
  args.push('--home', home)
  return args
}

/**
 * Process names a leftover simulator could be running under.
 *
 * SITL binds TCP 5760, and a second one cannot -- so a simulator this app
 * did not start (an orphan from a session that crashed or reloaded, or one
 * launched from the command line) makes every launch fail with a banner
 * that never arrives. Killing it is the right answer and needs no question
 * asked: nobody starts a simulator meaning to keep the previous one.
 *
 * Named rather than found by port on purpose. "Whatever holds 5760" could
 * be anything on a developer's machine, and this app has no business
 * killing a process it cannot identify -- so the set is exactly the
 * binaries it knows how to launch, plus whatever custom build is about to
 * be launched, and nothing else is ever a candidate.
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
 * Read what a build actually is, out of the build itself.
 *
 * Worth the read: the alternative is asking which vehicle an executable is,
 * and the answer is already inside it. Getting it wrong launches ArduPlane
 * against copter defaults, which fails in a way that looks like a broken
 * simulator rather than a wrong answer to a question nobody should have
 * been asked.
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
  // ArduRover and ArduSub have no entry in SIM_VEHICLES, so there is
  // nothing to launch them as -- saying so beats guessing copter. The
  // banner still matches all four on purpose: "this is an ArduRover build
  // and this app cannot run it" is a better answer than "not an ArduPilot
  // binary", which is what a narrower pattern would produce.
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

/**
 * Put the vehicle's stored parameters in place before it boots.
 *
 * A supplied eeprom.bin is copied over the one in the working directory
 * rather than pointed at, because ArduPilot has no option to read storage
 * from elsewhere -- it opens eeprom.bin in the directory it was started in,
 * and writes back to it. Copying also keeps the user's file out of the
 * simulator's way: the aircraft they distributed stays as they shipped it,
 * and the running copy is the one that accumulates changes.
 */
export function prepareWorkDir(workDir: string, params: SimParams): void {
  mkdirSync(workDir, { recursive: true })
  if (params.kind !== 'eeprom') return
  const dest = path.join(workDir, 'eeprom.bin')
  // Copying a file onto itself truncates it on some platforms, and the
  // obvious way to reach this is to pick the eeprom already in place.
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
 * The published SITL binaries are cygwin builds that link against ten DLLs
 * shipped beside them, and Windows resolves those from the executable's own
 * directory and then PATH. A custom build living anywhere else therefore
 * finds nothing -- and it does not say so: the process exits immediately
 * with status 0 and no output, which reads as "the simulator started and
 * stopped" rather than "a DLL is missing". Mission Planner does the same
 * thing for the same reason.
 *
 * The build's own directory goes first, so a self-contained build uses the
 * runtime it shipped with rather than ours.
 */
export function simEnv(baseDir: string, exe: string): NodeJS.ProcessEnv {
  const parts = [path.dirname(exe), baseDir, process.env.PATH ?? '']
  return { ...process.env, PATH: parts.filter(Boolean).join(path.delimiter) }
}

/**
 * Is RealFlight actually listening?
 *
 * Worth asking before launching, because the failure otherwise is silent
 * and slow: SITL retries the SOAP connection forever without printing its
 * readiness banner, so what the user sees is the simulator hanging for
 * thirty seconds and then a timeout that says nothing about RealFlight.
 *
 * A plain TCP connect, not a SOAP call: this answers "is something there",
 * and if something is there but is not RealFlight, SITL's own error is the
 * better one to show.
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
