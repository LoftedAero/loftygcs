import { app, ipcMain, type BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import {
  SITL_PORT,
  SIM_VEHICLES,
  installVehicle,
  installedVehicles,
  simSupported,
  spawnSim,
  waitForReady,
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

  ipcMain.handle('sim:start', async (_e, vehicle: SimVehicle) => {
    stopSim()
    const proc = spawnSim(simDir(), vehicle)
    child = proc
    runningVehicle = vehicle
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
    return SITL_PORT
  })

  ipcMain.handle('sim:stop', () => stopSim())

  // Never leave a simulator running after the window is gone.
  app.on('before-quit', stopSim)
}
