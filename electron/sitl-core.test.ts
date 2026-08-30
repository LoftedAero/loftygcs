import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  READY_PATTERN,
  SIM_VEHICLES,
  executableName,
  installedVehicles,
  isInstalled,
  simArgs,
  simSupported,
  spawnSim,
  waitForReady,
} from './sitl-core'

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
    const args = simArgs('copter')
    // -w wipes stored params so a session always starts identical...
    expect(args).toContain('-w')
    // ...and the defaults file is what makes prearm pass at all.
    expect(args).toContain('--defaults')
    expect(args).toContain('copter.parm')
    // No --rate override: forcing one drops the gyro sample rate under the
    // arming check's threshold and the vehicle then never arms.
    expect(args).not.toContain('--rate')
    expect(args.join(' ')).toMatch(/--home -35\.363262/)
  })

  it('uses the right physics model per vehicle', () => {
    expect(simArgs('plane')).toContain(SIM_VEHICLES.plane.model)
    expect(simArgs('rover')).toContain('rover')
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
    child = spawnSim(dir, 'copter')
    await waitForReady(child, 30000)
    // Still alive: readiness detection must not consume the one client slot.
    expect(child.killed).toBe(false)
    expect(child.exitCode).toBeNull()
  }, 45000)
})
