import { app, BrowserWindow, ipcMain, net, shell, session } from 'electron'
import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import { withDriverNames } from './serial-names'
import { pickBootloaderPort } from './serial-autopick'
import { closeAllLinks, registerLinkIpc } from './ipc-links'
import { registerSitlIpc, stopSim } from './sitl'
import { registerVideoHandlers, stopVideo } from './video'

// The renderer is the same build the browser gets. Electron adds the window,
// the privileged link sockets (ipc-links.ts) and the Web Serial permission
// plumbing, all reached through preload.ts with contextIsolation and sandbox on.

// Electron names the data folder after the product, and the early previews were
// called Loft GCS. Moving the old folder once keeps settings, saved
// simulators and the SITL download. Electron creates the new folder, empty,
// before this runs, so an empty one counts as not there yet.
function adoptPreRenameData(): void {
  const current = app.getPath('userData')
  const old = path.join(app.getPath('appData'), 'Loft GCS')
  if (!existsSync(old)) return
  try {
    if (existsSync(current)) {
      if (readdirSync(current).length > 0) return
      rmdirSync(current)
    }
    renameSync(old, current)
  } catch {
    // Locked by a running copy of the old app, or on another volume: start fresh.
  }
}
adoptPreRenameData()

let mainWindow: BrowserWindow | null = null

// Electron fires select-serial-port when the renderer calls
// navigator.serial.requestPort(). Main forwards the candidate list to the
// renderer, which draws its own chooser, and holds the callback until the user
// or the auto-pick rule answers. The list stays live while the request is
// open (`serial-port-added` / `-removed`), so a board plugged in after the
// chooser opens still shows up.
interface OpenPortRequest {
  /** Every port currently on the machine, as far as this request knows. */
  ports: Map<string, Electron.SerialPort>
  /** The ports listed when the request opened, so an arrival is anything else. */
  initial: ReadonlySet<string>
  /** Answer from the rule in serial-autopick.ts rather than asking, if it can. */
  auto: boolean
  /** Whether the chooser is on screen; a live update re-sends the list only then. */
  shown: boolean
  /** Ports that turned up while this request was open. */
  arrived: Set<string>
  callback: (portId: string) => void
  hold?: ReturnType<typeof setTimeout>
}
let openPortRequest: OpenPortRequest | null = null
const traceSerial = (...args: unknown[]) => {
  if (process.env.LOFTGCS_DEBUG_SERIAL) console.log('[serial]', ...args)
}
const brief = (p: Electron.SerialPort) => `${p.portName}(${p.portId}) "${p.displayName}"`

// The same switch for USB. Main answers `select-usb-device` itself with no
// chooser, so a DFU board that is not found leaves no trace on screen.
const traceUsb = (...args: unknown[]) => {
  if (process.env.LOFTGCS_DEBUG_USB) console.log('[usb]', ...args)
}
const briefUsb = (d: { vendorId?: number; productId?: number; productName?: string }) =>
  `${(d.vendorId ?? 0).toString(16).padStart(4, '0')}:${(d.productId ?? 0)
    .toString(16)
    .padStart(4, '0')} "${d.productName ?? ''}"`

// Every port Chromium listed the last time it asked, and whether the next
// ask should be answered from the difference rather than shown.
let lastSerialPortIds = new Set<string>()
let autoPickNewPort: { wait: boolean } | null = null

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
  // Maximized rather than fullscreen, so the taskbar stays reachable. The
  // size above is the restored size.
  mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  /**
   * A reloaded renderer has forgotten every link it opened. The sockets and
   * the video receiver live here and are closed by id from the renderer, so
   * a reload would leak them and a bound UDP port would then fail with
   * EADDRINUSE. The simulator is left running: it is a separate process, not
   * renderer state.
   */
  const dropRendererState = () => {
    closeAllLinks()
    stopVideo()
  }
  mainWindow.webContents.on('did-start-loading', dropRendererState)
  mainWindow.webContents.on('render-process-gone', dropRendererState)

  const serialSession = mainWindow.webContents.session

  // Send the list to the renderer's chooser with the USB descriptors, since
  // bare COM names are not a choice anyone can make. `displayName` is the USB
  // product string, which names the device rather than the interface, so a
  // CubeOrange's MAVLink and SLCAN ports look identical. The Windows driver
  // names tell them apart (serial-names.ts).
  const publishPorts = (r: OpenPortRequest) => {
    traceSerial('publish', [...r.ports.values()].map(brief))
    r.shown = true
    void withDriverNames(
      [...r.ports.values()].map((p) => ({
        portId: p.portId,
        portName: p.portName,
        displayName: p.displayName,
        vendorId: p.vendorId,
        productId: p.productId,
        serialNumber: p.serialNumber,
        deviceInstanceId: p.deviceInstanceId,
      })),
    ).then((ports) => {
      // The request may have ended while the driver names were being read.
      if (openPortRequest === r) mainWindow?.webContents.send('serial:ports', ports)
    })
  }

  // Every request ends here. `serial:done` closes a chooser that main answered
  // on the user's behalf; if the user answered, the modal is already closed.
  const endPortRequest = (portId: string) => {
    const r = openPortRequest
    if (!r) return
    traceSerial('end', portId || '(cancel)', 'shown=' + r.shown)
    openPortRequest = null
    clearTimeout(r.hold)
    r.callback(portId)
    if (r.shown) mainWindow?.webContents.send('serial:done')
  }

  // Answer for the user when there is exactly one bootloader port that
  // appeared while the board rebooted (rule in serial-autopick.ts). Windows
  // driver names are needed because after a reboot the old MAVLink port
  // lingers as a phantom whose product string also reads as a bootloader.
  // That lookup is async, so recheck that this is still the open request.
  const tryAutoAnswer = async (r: OpenPortRequest, before: ReadonlySet<string>) => {
    if (!r.auto) return false
    // `withDriverNames` overwrites `displayName` with the driver name. The
    // recognizer needs both, so keep them apart.
    const list = [...r.ports.values()]
    const named = await withDriverNames(
      list.map((p) => ({
        portId: p.portId,
        portName: p.portName,
        displayName: p.displayName,
        vendorId: p.vendorId,
        productId: p.productId,
        serialNumber: p.serialNumber,
        deviceInstanceId: p.deviceInstanceId,
      })),
    )
    if (openPortRequest !== r) return true
    const candidates = named.map((n, i) => ({
      ...n,
      displayName: list[i]!.displayName,
      driverName: n.displayName !== list[i]!.displayName ? n.displayName : undefined,
    }))
    const pick = pickBootloaderPort(candidates, before, r.arrived)
    traceSerial(
      'auto-answer',
      pick ?? '(none)',
      candidates.map((c) => `${c.portName} "${c.displayName}" / ${c.driverName ?? '-'}`),
    )
    if (!pick) return false
    endPortRequest(pick)
    return true
  }

  serialSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault()
    traceSerial(
      'select-serial-port',
      'auto=' + JSON.stringify(autoPickNewPort),
      portList.map(brief),
    )
    // Chromium serializes requests, but a stale one must never answer a new one.
    if (openPortRequest) endPortRequest('')

    const before = lastSerialPortIds
    const ports = new Map(portList.map((p) => [p.portId, p]))
    lastSerialPortIds = new Set(ports.keys())
    const arm = autoPickNewPort
    autoPickNewPort = null
    const r: OpenPortRequest = {
      ports,
      initial: new Set(ports.keys()),
      auto: arm !== null,
      shown: false,
      arrived: new Set(),
      callback,
    }
    openPortRequest = r

    void tryAutoAnswer(r, before).then((answered) => {
      if (answered || openPortRequest !== r) return
      // A request made right after a reboot (while the click is still a user
      // gesture) holds the chooser back briefly, since the board takes a
      // second or two to come back. A bootloader arriving later still
      // answers the request itself.
      if (!arm?.wait) {
        publishPorts(r)
        return
      }
      r.hold = setTimeout(() => {
        if (openPortRequest === r) publishPorts(r)
      }, 2500)
    })
  })

  serialSession.on('serial-port-added', (_e, port) => {
    traceSerial('serial-port-added', brief(port), 'open=' + !!openPortRequest)
    lastSerialPortIds.add(port.portId)
    const r = openPortRequest
    if (!r) return
    r.ports.set(port.portId, port)
    r.arrived.add(port.portId)
    void tryAutoAnswer(r, r.initial).then((answered) => {
      if (!answered && openPortRequest === r && r.shown) publishPorts(r)
    })
  })

  serialSession.on('serial-port-removed', (_e, port) => {
    traceSerial('serial-port-removed', brief(port), 'open=' + !!openPortRequest)
    lastSerialPortIds.delete(port.portId)
    const r = openPortRequest
    if (!r) return
    r.ports.delete(port.portId)
    if (r.shown) publishPorts(r)
  })

  ipcMain.on('serial:choose', (_e, portId: string) => endPortRequest(portId))
  ipcMain.on('serial:cancel', () => endPortRequest(''))

  // Without these handlers Chromium denies Web Serial and WebUSB outside a
  // browser profile. USB is limited to the ST DFU bootloader (0483:DF11).
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_wc, permission) => permission === 'serial' || permission === 'usb',
  )
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true
    if (details.deviceType === 'usb') {
      const d = details.device as { vendorId?: number; productId?: number }
      const ok = d.vendorId === 0x0483 && d.productId === 0xdf11
      traceUsb('permission', briefUsb(d), ok ? 'granted' : 'denied')
      return ok
    }
    return false
  })

  // WebUSB's requestDevice: only DFU devices are ever requested, so pick the
  // first match. With no match yet, hold the request: Chromium can enumerate
  // a device that was plugged in before the app started over a second after
  // the request arrives.
  const usbSession = mainWindow.webContents.session
  const isDfu = (d: { vendorId: number; productId: number }) =>
    d.vendorId === 0x0483 && d.productId === 0xdf11
  usbSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    const dfu = details.deviceList.find(isDfu)
    traceUsb('select', details.deviceList.map(briefUsb), '->', dfu ? briefUsb(dfu) : '(none)')
    if (dfu) return callback(dfu.deviceId)

    let settled = false
    const settle = (deviceId?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      usbSession.removeListener('usb-device-added', onAdded)
      traceUsb('select held ->', deviceId ?? '(none)')
      callback(deviceId)
    }
    const onAdded = (_e: unknown, device: Electron.USBDevice) => {
      if (isDfu(device)) settle(device.deviceId)
    }
    usbSession.on('usb-device-added', onAdded)
    // Same hold as the serial side: long enough for a device that is coming,
    // short enough that a missing board still fails promptly.
    const timer = setTimeout(() => settle(undefined), 2500)
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
  // The window never loads remote pages; the packaged file:// load relies on
  // sandbox and contextIsolation, since a header CSP only covers http(s).
  // Serial and USB go through the handlers in createWindow, so every
  // permission request that reaches this one is denied.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => {
    cb(false)
  })

  ipcMain.handle('app:version', () => app.getVersion())

  // firmware.ardupilot.org sends no CORS headers, so the renderer cannot
  // fetch from it directly. Locked to that origin; this is not a general proxy.
  ipcMain.handle('app:fetch-firmware', async (_e, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://firmware.ardupilot.org/')) {
      throw new Error('refused: only firmware.ardupilot.org URLs')
    }
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
    return await res.arrayBuffer()
  })
  // Background throttling is off while the gamepad has control. A throttled
  // window that is covered or unfocused reports itself hidden, which pauses
  // gamepad input while the override stream keeps sending the last sticks.
  ipcMain.on('app:background-throttling', (e, allowed: unknown) => {
    e.sender.setBackgroundThrottling(allowed !== false)
  })
  ipcMain.on('app:open-external', (_e, url: string) => {
    // Web links and mailto only. A file: or custom scheme from a compromised
    // renderer could open files or launch applications.
    if (typeof url === 'string' && /^(https?:\/\/|mailto:)/.test(url)) {
      void shell.openExternal(url)
    }
  })

  // Armed by the flash path just before it reboots a board, so the next
  // request can recognize the bootloader without asking. One-shot and
  // expiring, so it cannot answer an unrelated request later.
  ipcMain.on('serial:auto-pick-new', (_e, opts: { wait?: boolean } = {}) => {
    traceSerial('armed', JSON.stringify(opts))
    const arm = { wait: !!opts.wait }
    autoPickNewPort = arm
    setTimeout(() => {
      if (autoPickNewPort === arm) autoPickNewPort = null
    }, 15000)
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
