import { app, BrowserWindow, ipcMain, net, shell, session } from 'electron'
import path from 'node:path'
import { closeAllLinks, registerLinkIpc } from './ipc-links'
import { registerSitlIpc, stopSim } from './sitl'
import { registerVideoHandlers, stopVideo } from './video'

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

  /**
   * A renderer that reloads has forgotten every link it opened.
   *
   * The sockets live here, in the main process, and are closed one id at a
   * time by the renderer that opened them -- so a reload leaks them, and a
   * bound UDP link keeps its port. The next connection then fails with
   * EADDRINUSE on a machine where nothing appears to be running, which is
   * the kind of thing that gets blamed on the autopilot. The video
   * receiver is bound the same way and goes for the same reason.
   *
   * `did-start-loading` also fires for the first load, where there is
   * nothing to close and this costs nothing. The simulator is deliberately
   * left alone: it is a separate process serving a port, not renderer
   * state, and reloading the window is not a reason to end a flight.
   */
  const dropRendererState = () => {
    closeAllLinks()
    stopVideo()
  }
  mainWindow.webContents.on('did-start-loading', dropRendererState)
  mainWindow.webContents.on('render-process-gone', dropRendererState)

  mainWindow.webContents.session.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault()
    pendingPortCallback = callback
    // The descriptors travel with the port, because a list of COM7 / COM12 is
    // not a choice anyone can make. The OS product string is the honest
    // source for "which board is this"; the ids are what identifies it when
    // the string is missing or generic, which is most CH340-style adapters.
    mainWindow?.webContents.send(
      'serial:ports',
      portList.map((p) => ({
        portId: p.portId,
        portName: p.portName,
        displayName: p.displayName,
        vendorId: p.vendorId,
        productId: p.productId,
        serialNumber: p.serialNumber,
      })),
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
    // Web links, plus mailto -- a file: or custom scheme from a compromised
    // renderer must not reach the shell. mailto is the one exception worth
    // making: the worst it can do is open a compose window the user still
    // has to send, where file: hands over files and a registered custom
    // scheme can launch an application outright.
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/.test(url)) {
      void shell.openExternal(url)
    }
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
  registerVideoHandlers(() => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSim()
  stopVideo()
  closeAllLinks()
  if (process.platform !== 'darwin') app.quit()
})

// macOS keeps the app alive with no windows, so quitting is its own event
// there rather than a consequence of the last window closing.
app.on('before-quit', () => {
  stopSim()
  stopVideo()
  closeAllLinks()
})
