import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import {
  FLIGHTAXIS_HOST,
  FLIGHTAXIS_PORT,
  SITL_PORT,
  SIM_VEHICLES,
  flightAxisReachable,
  installVehicle,
  installedVehicles,
  readBuildInfo,
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
      const host = launch.physics.host || FLIGHTAXIS_HOST
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
    const proc = spawnSim(simDir(), launch)
    child = proc
    runningVehicle = launch.vehicle
    proc.stdout?.on('data', (d: Buffer) => send('sim:log', d.toString()))
    proc.stderr?.on('data', (d: Buffer) => send('sim:log', d.toString()))
    proc.on('exit', () => {
      // SITL quits when its TCP client disconnects, so an exit here is
      // usually the app disconnecting -- report it, don't treat it as a fault.
      if (child === proc) {
        child = null
        runningVehicle = null
      }
      send('sim:exit')
    })
    try {
      await waitForReady(proc)
    } catch (err) {
      stopSim()
      throw err
    }
    return { port: SITL_PORT, waitingForRealFlight }
  })

  ipcMain.handle('sim:stop', () => stopSim())

  // Choosing a build or a parameter file needs a real path, which a file
  // input in the renderer cannot give -- it hands over contents, and SITL
  // has to be handed something to execute.
  ipcMain.handle('sim:pick-build', async () => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a SITL build',
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

  ipcMain.handle('sim:pick-params', async () => {
    const win = getWindow()
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose parameters or a stored EEPROM',
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
