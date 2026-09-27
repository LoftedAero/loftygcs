import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { execFileSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import {
  FLIGHTAXIS_HOST,
  FLIGHTAXIS_PORT,
  SITL_PORT,
  SIM_VEHICLES,
  flightAxisReachable,
  installVehicle,
  installedVehicles,
  readBuildInfo,
  simProcessNames,
  simSupported,
  spawnSim,
  waitForReady,
  type SimLaunch,
  type SimVehicle,
} from './sitl-core'

// IPC glue for the managed simulator. One SITL at a time, owned here so it
// dies with the app rather than outliving it as an orphan holding port 5760.

let child: ChildProcess | null = null
let runningVehicle: SimVehicle | null = null

function simDir(): string {
  return path.join(app.getPath('userData'), 'sitl')
}

/**
 * Kill any simulator this app is not holding on to.
 *
 * A second SITL cannot bind TCP 5760, so a leftover one (from a crashed
 * session or a terminal) makes every launch fail. Starting a simulator means
 * "this one now", so the old one is killed without asking. Only processes
 * named in `simProcessNames` are candidates.
 *
 * `npm run sitl` supervises its child and relaunches it, so killing that
 * child starts a race the supervisor wins. Stop the runner instead.
 */
function killStraySims(exe?: string): void {
  const names = simProcessNames(exe)
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', ...names.flatMap((n) => ['/IM', n])], { stdio: 'ignore' })
    } else {
      execFileSync('pkill', ['-f', names.join('|')], { stdio: 'ignore' })
    }
  } catch {
    // Both exit non-zero when nothing matched, which is the ordinary case.
  }
}

export function stopSim() {
  const proc = child
  child = null
  runningVehicle = null
  proc?.kill()
}

export function registerSitlIpc(getWindow: () => BrowserWindow | null) {
  const send = (channel: string, ...args: unknown[]) =>
    getWindow()?.webContents.send(channel, ...args)

  ipcMain.handle('sim:status', () => ({
    supported: simSupported(),
    vehicles: Object.entries(SIM_VEHICLES).map(([id, spec]) => ({ id, label: spec.label })),
    installed: simSupported() ? installedVehicles(simDir()) : [],
    running: runningVehicle,
    port: SITL_PORT,
  }))

  ipcMain.handle('sim:install', async (_e, vehicle: SimVehicle) => {
    await installVehicle(simDir(), vehicle, (p) => send('sim:progress', p))
  })

  ipcMain.handle('sim:start', async (_e, launch: SimLaunch) => {
    stopSim()
    // RealFlight does not have to be running first: SITL binds its GCS port
    // and prints its banner either way, and its socket_creator thread retries
    // the SOAP connection for as long as it runs. But it sends no MAVLink
    // until FlightAxis is exchanging data, so a GCS attaches to a silent port.
    // Warn in advance, since "connected, no heartbeat" does not point at
    // RealFlight on its own.
    let waitingForRealFlight = false
    if (launch.physics?.kind === 'flightaxis') {
      const host = FLIGHTAXIS_HOST
      waitingForRealFlight = !(await flightAxisReachable(host))
      if (waitingForRealFlight) {
        send(
          'sim:log',
          `Nothing is listening on ${host}:${FLIGHTAXIS_PORT} yet. The simulator will start ` +
            'and wait for it. Turn on Simulation > Settings > Physics > "RealFlight Link ' +
            'enabled", then connect.\n',
        )
      }
    }
    // Home is read at boot, so changing it means a restart.
    //
    // Two attempts, clearing stray simulators before each. The retry covers
    // the gap between killing a process and its listening socket being freed.
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      killStraySims(launch.exe)
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500))
      const proc = spawnSim(simDir(), launch)
      child = proc
      runningVehicle = launch.vehicle
      proc.stdout?.on('data', (d: Buffer) => send('sim:log', d.toString()))
      proc.stderr?.on('data', (d: Buffer) => send('sim:log', d.toString()))
      proc.on('exit', () => {
        // SITL quits when its TCP client disconnects, so an exit here is
        // usually the app disconnecting, not a fault.
        if (child === proc) {
          child = null
          runningVehicle = null
        }
        send('sim:exit')
      })
      try {
        await waitForReady(proc)
        return { port: SITL_PORT, waitingForRealFlight }
      } catch (err) {
        lastErr = err
        stopSim()
      }
    }
    throw lastErr
  })

  ipcMain.handle('sim:stop', () => stopSim())

  // Picking a build or parameter file needs a real path, which a renderer
  // file input cannot provide.
  ipcMain.handle('sim:pick-build', async (_e, startIn?: string) => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a SITL build',
      // Only if it still exists.
      ...(startIn && existsSync(startIn) ? { defaultPath: startIn } : {}),
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'SITL build', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    })
    const file = canceled ? undefined : filePaths[0]
    if (!file) return null
    // Identify the vehicle from the binary rather than asking.
    const info = readBuildInfo(file)
    return info ? { path: file, ...info } : { path: file }
  })

  ipcMain.handle('sim:pick-params', async (_e, startIn?: string) => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose parameters or a stored EEPROM',
      ...(startIn && existsSync(startIn) ? { defaultPath: startIn } : {}),
      properties: ['openFile'],
      filters: [
        { name: 'Parameters or EEPROM', extensions: ['parm', 'param', 'bin'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    const file = canceled ? undefined : filePaths[0]
    return file ?? null
  })

  // Never leave a simulator running after the window is gone.
  app.on('before-quit', stopSim)
}
