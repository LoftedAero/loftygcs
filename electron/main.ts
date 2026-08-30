import { app, BrowserWindow, ipcMain, net, shell, session } from 'electron'
import path from 'node:path'
import { registerLinkIpc } from './ipc-links'
import { registerSitlIpc, stopSim } from './sitl'

// The renderer is the same build the browser gets; Electron's job is the
// window, the privileged link sockets (ipc-links.ts), and the Web Serial
// permission plumbing. All renderer access to any of it goes through
// preload.ts -- contextIsolation and sandbox stay on.

let mainWindow: BrowserWindow | null = null

// Electron fires select-serial-port when the renderer calls
// navigator.serial.requestPort(). We forward the candidate list to the
// renderer so the app can draw its own chooser in the house style, and hold
// the callback until it answers.
let pendingPortCallback: ((portId: string) => void) | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false, // paint before showing, no flash of unstyled white
    backgroundColor: '#F1F2F5', // matches --la-bg
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.session.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault()
    pendingPortCallback = callback
    mainWindow?.webContents.send(
      'serial:ports',
      portList.map((p) => ({ portId: p.portId, portName: p.portName })),
    )
  })

  // Web Serial and WebUSB need these handlers to say yes; without them
  // Chromium's default denies the APIs outside a browser profile. USB stays
  // scoped to the ST DFU bootloader (0483:DF11) -- the recovery-flash path.
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_wc, permission) => permission === 'serial' || permission === 'usb',
  )
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true
    if (details.deviceType === 'usb') {
      const d = details.device as { vendorId?: number; productId?: number }
      return d.vendorId === 0x0483 && d.productId === 0xdf11
    }
    return false
  })

  // WebUSB's requestDevice: only DFU devices are ever requested, so pick
  // the first match rather than building a chooser for a one-device list.
  mainWindow.webContents.session.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    const dfu = details.deviceList.find(
      (d) => d.vendorId === 0x0483 && d.productId === 0xdf11,
    )
    callback(dfu?.deviceId)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist-web/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // Only the Google Fonts hosts are legitimate remote origins for the shell
  // itself; everything else the app fetches (firmware manifests, param
  // metadata) goes through explicit fetch() calls that can fail gracefully.
  // A stricter CSP via response headers only covers http(s) responses, so the
  // packaged file:// load is instead kept safe by sandbox + contextIsolation
  // and by never loading remote pages into this window.
  // Web Serial goes through the check/device handlers set in createWindow,
  // not this one -- so everything that does arrive here can be denied.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => {
    cb(false)
  })

  ipcMain.handle('app:version', () => app.getVersion())

  // Firmware downloads: firmware.ardupilot.org sends no CORS headers, so
  // the renderer cannot fetch it directly; the main process can. Locked to
  // that one origin -- this is a firmware pipe, not a general proxy.
  ipcMain.handle('app:fetch-firmware', async (_e, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://firmware.ardupilot.org/')) {
      throw new Error('refused: only firmware.ardupilot.org URLs')
    }
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    return await res.arrayBuffer()
  })
  ipcMain.on('app:open-external', (_e, url: string) => {
    // Only ever open web links -- a file: or custom scheme from a compromised
    // renderer must not reach the shell.
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.on('serial:choose', (_e, portId: string) => {
    pendingPortCallback?.(portId)
    pendingPortCallback = null
  })
  ipcMain.on('serial:cancel', () => {
    pendingPortCallback?.('')
    pendingPortCallback = null
  })

  registerLinkIpc(() => mainWindow)
  registerSitlIpc(() => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSim()
  if (process.platform !== 'darwin') app.quit()
})
