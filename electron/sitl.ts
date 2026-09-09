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
 * SITL binds TCP 5760 and a second one cannot, so one left over -- from a
 * session that crashed or reloaded, or started from a terminal -- fails
 * every launch with a readiness banner that never arrives. Starting a
 * simulator plainly means "this one now", so it is taken rather than
 * reported: there is no question worth asking and no reason to make the
 * user find a stray process themselves.
 *
 * Only ever the binaries this app knows how to launch, plus the custom
 * build about to be launched. Killing "whatever holds 5760" would be
 * killing something unidentified on a developer's machine.
 *
 * One caveat worth knowing: `npm run sitl` supervises its child and
 * relaunches it, so killing that child starts a race the supervisor wins.
 * Stop the runner rather than expecting the app to win it.
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
    // Ask RealFlight whether it is there before launching into it. SITL
    // retries the SOAP connection forever without ever printing its
    // readiness banner, so the failure is otherwise a thirty-second hang
    // and a timeout that never mentions RealFlight.
    // RealFlight does not have to be up first, and refusing to launch
    // without it was wrong. SITL binds its GCS port and prints its
    // readiness banner in about 40 ms whether or not anything is listening
    // on 18083, and its socket_creator thread retries the SOAP connection
    // for as long as it runs -- so starting the simulator and then starting
    // RealFlight is a perfectly good order to do things in.
    //
    // What it does *not* do is send any MAVLink until FlightAxis is
    // exchanging data: the vehicle's update() returns early with no sample,
    // so a GCS attaches to a silent port and times out waiting for a
    // heartbeat. That is worth saying in advance, because "connected, no
    // heartbeat" does not point at RealFlight on its own.
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
    // Home is taken at boot and cannot be moved afterwards, which is why
    // changing it in the UI is a restart rather than a setting.
    //
    // Attempted twice, and a stray simulator is cleared before each. The
    // first pass covers the ordinary case -- something left running. The
    // second exists because killing a process and freeing its listening
    // socket are not the same instant, so a launch that lost that race
    // deserves another go rather than an error the user has to act on.
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
        // usually the app disconnecting -- report it, don't treat it as a
        // fault.
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

  // Choosing a build or a parameter file needs a real path, which a file
  // input in the renderer cannot give -- it hands over contents, and SITL
  // has to be handed something to execute.
  ipcMain.handle('sim:pick-build', async (_e, startIn?: string) => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a SITL build',
      // A folder that has since been deleted or moved would leave the
      // dialog with nowhere to open, so it is offered only if it is there.
      ...(startIn && existsSync(startIn) ? { defaultPath: startIn } : {}),
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'SITL build', extensions: ['exe'] }]
          : [{ name: 'All files', extensions: ['*'] }],
    })
    const file = canceled ? undefined : filePaths[0]
    if (!file) return null
    // What it is comes out of the binary rather than out of a question:
    // launching ArduPlane against copter defaults fails in a way that looks
    // like a broken simulator instead of a wrong answer.
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
