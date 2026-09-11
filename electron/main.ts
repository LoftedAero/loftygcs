import { app, BrowserWindow, ipcMain, net, shell, session } from 'electron'
import path from 'node:path'
import { withDriverNames } from './serial-names'
import { pickBootloaderPort } from './serial-autopick'
import { closeAllLinks, registerLinkIpc } from './ipc-links'
import { registerSitlIpc, stopSim } from './sitl'
import { registerVideoHandlers, stopVideo } from './video'

// The renderer is the same build the browser gets; Electron's job is the
// window, the privileged link sockets (ipc-links.ts), and the Web Serial
// permission plumbing. All renderer access to any of it goes through
// preload.ts -- contextIsolation and sandbox stay on.

let mainWindow: BrowserWindow | null = null

// Electron fires select-serial-port when the renderer calls
// navigator.serial.requestPort(). This process owns the answer: it forwards
// the candidate list to the renderer so the app can draw its own chooser in
// the house style, holds the callback until somebody -- or the rule below --
// answers, and keeps the list **live** for as long as the request is open.
//
// Live because Chromium tells this process about every port that appears or
// goes away while a request is pending (`serial-port-added` / `-removed`),
// and a chooser that showed the list as it stood when it opened was a
// chooser that could not see the board plugged in a second later. Measured
// on the bench: the bootloader was not in the list, and restarting the whole
// flow was the only way to get a list that had it.
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

// The same switch for the USB side. WebUSB in the shell shows nobody a
// chooser -- main answers `select-usb-device` itself -- so a DFU board that
// is not found leaves no trace on screen at all, which is what this is for.
const traceUsb = (...args: unknown[]) => {
  if (process.env.LOFTGCS_DEBUG_USB) console.log('[usb]', ...args)
}
const briefUsb = (d: { vendorId?: number; productId?: number; productName?: string }) =>
  `${(d.vendorId ?? 0).toString(16).padStart(4, '0')}:${(d.productId ?? 0)
    .toString(16)
    .padStart(4, '0')} "${d.productName ?? ''}"`

// Every port Chromium listed the last time it asked, and whether the next
// ask should be answered from the difference rather than shown. See the
// select-serial-port handler for why this is safe.
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
  // Maximized, not fullscreen: a ground station is a window someone alt-tabs
  // to a browser and a log viewer from, and true fullscreen hides the taskbar
  // it takes to get back. The width and height above stay as the restored
  // size, so un-maximizing gives a usable window rather than a sliver.
  mainWindow.maximize()
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

  const serialSession = mainWindow.webContents.session

  // Put the list in front of the user, in the house style. The descriptors
  // travel with the port, because a list of COM7 / COM12 is not a choice
  // anyone can make. The OS product string is the honest source for "which
  // board is this"; the ids are what identifies it when the string is
  // missing or generic, which is most CH340-style adapters. `displayName` is
  // the USB *product* string, which describes the device and not the
  // interface -- so a CubeOrange's MAVLink and SLCAN ports arrive as two
  // identical rows. The Windows driver names them apart, and that is the
  // same source Mission Planner reads; see serial-names.ts.
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

  // One request ends here, however it ends. `serial:done` closes a chooser
  // that main answered over the top of; for one the user answered it is a
  // no-op, the modal having closed itself.
  const endPortRequest = (portId: string) => {
    const r = openPortRequest
    if (!r) return
    traceSerial('end', portId || '(cancel)', 'shown=' + r.shown)
    openPortRequest = null
    clearTimeout(r.hold)
    r.callback(portId)
    if (r.shown) mainWindow?.webContents.send('serial:done')
  }

  // Answer for the user when the answer is a fact rather than a choice --
  // the port that appeared while the board rebooted into its bootloader.
  // The rule is in serial-autopick.ts, where it can be tested; `initial`
  // rather than the previous request's list is what an arrival is measured
  // against, because a bootloader seen in some earlier request still counts
  // as new to this one. Exactly one, or keep waiting.
  //
  // Decided with the Windows driver names in hand, not Chromium's product
  // strings alone: after a reboot the old MAVLink port lingers as a phantom
  // whose product string reads as a bootloader too, and only the driver name
  // says which of the two is real. Async for that reason, so it re-checks
  // that this is still the open request before answering it.
  const tryAutoAnswer = async (r: OpenPortRequest, before: ReadonlySet<string>) => {
    if (!r.auto) return false
    // `withDriverNames` replaces `displayName` with the Windows friendly
    // name, which is what the chooser wants. The recogniser wants both --
    // the product string to spot a bootloader, the driver name to veto a
    // phantom -- so the two are kept apart here rather than one overwriting
    // the other.
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
    // Chromium serialises requests, but a stale one must never answer a new one.
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
      // Not obvious. For the ask before a reboot that is the end of it: the
      // chooser comes up at once. For the ask *after* one, the renderer sent
      // it the moment the reboot went out, while its click still counted as
      // a gesture, and the board takes a second or two to come back -- so
      // the chooser is held back that long rather than flashing up and
      // vanishing. Live either way, so it shows the port the moment it does
      // arrive, and a bootloader arriving later still answers itself.
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

  // Web Serial and WebUSB need these handlers to say yes; without them
  // Chromium's default denies the APIs outside a browser profile. USB stays
  // scoped to the ST DFU bootloader (0483:DF11), which is how a board with no
  // ArduPilot bootloader gets one -- not a recovery path.
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

  // WebUSB's requestDevice: only DFU devices are ever requested, so pick
  // the first match rather than building a chooser for a one-device list.
  //
  // And **hold the request if there is no match yet**, exactly as the serial
  // chooser does. Measured on the bench, with a board sitting in DFU mode
  // since before the app launched: `getDevices()` was empty 2.3 s in, this
  // list was empty at 4.6 s, and Chromium enumerated the device 1.2 s after
  // that. Answering "(none)" on the first look therefore reported no board
  // while one was on the bus and WinUSB-bound -- the whole DFU path, failing
  // on a race nobody could see, because the shell answers this event itself
  // and so shows no chooser to notice was wrong.
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
    // The same 2.5 s the serial hold uses, and for the same reason: long
    // enough for a device that is coming, short enough that a board which is
    // simply not there still fails while somebody is still watching.
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

  // Armed by the flash path immediately before it reboots a board: the next
  // request is for that board's bootloader, and the app can recognise it
  // without asking. One-shot, and it expires -- an arm left standing could
  // silently answer an unrelated request minutes later.
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
