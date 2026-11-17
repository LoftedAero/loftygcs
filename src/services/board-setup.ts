// The flight controller half of a Lofted Aero board's setup. A blank board
// takes the build's _with_bl.hex (ArduPilot's bootloader and the firmware in
// one image) over the STM32's ROM DFU; a board that has the bootloader takes
// the .apj through it, as every later update does.

import { DFU_PRODUCT_ID, DFU_VENDOR_ID } from '../protocol/bootloader/dfu'
import { parseApj } from '../protocol/bootloader/apj'
import { parseIntelHex } from '../protocol/bootloader/intel-hex'
import type { CatalogBoard, CatalogRelease, FirmwareOption } from '../protocol/lofted-boards'
import { bootBoard, flashDfu, flashSerial, identifyBoard, rebootToBootloader } from './flash'
import { downloadCatalogFile } from './lofted-catalog'
import { connectionService } from './connection'
import { until } from './receiver-flash'
import type { HeldBoard } from '../stores/board-setup-store'
import { useConnectionStore } from '../stores/connection-store'
import { useParamStore } from '../stores/param-store'
import { grantedSerialPorts, requestSerialPort } from '../transport/web-serial'
import { isElectron } from '../env'

const isDfu = (d: USBDevice) => d.vendorId === DFU_VENDOR_ID && d.productId === DFU_PRODUCT_ID

export const webUsbAvailable = () => typeof navigator !== 'undefined' && 'usb' in navigator

/**
 * A board in ROM DFU that this app may open without asking. The desktop app
 * grants every 0483:DF11; a browser lists only a chip granted before.
 */
export async function grantedDfuDevice(): Promise<USBDevice | null> {
  if (!webUsbAvailable()) return null
  const devices = await navigator.usb.getDevices().catch(() => [] as USBDevice[])
  return devices.find(isDfu) ?? null
}

/** Raise the chooser for a DFU device; null when canceled. Needs a user gesture. */
export async function chooseDfuDevice(): Promise<USBDevice | null> {
  if (!webUsbAvailable()) return null
  return navigator.usb
    .requestDevice({ filters: [{ vendorId: DFU_VENDOR_ID, productId: DFU_PRODUCT_ID }] })
    .catch(() => null)
}

/**
 * Call `onFound` once a DFU device this app may open is present. Returns a
 * stop function. A `connect` event covers a device that arrives; the poll
 * covers one that was already there or was granted elsewhere.
 */
export function watchForDfu(onFound: (d: USBDevice) => void): () => void {
  let stopped = false
  const check = async () => {
    const d = await grantedDfuDevice()
    if (d && !stopped) {
      stopped = true
      onFound(d)
    }
  }
  const onConnect = () => void check()
  navigator.usb?.addEventListener('connect', onConnect)
  const timer = setInterval(() => void check(), 500)
  void check()
  return () => {
    stopped = true
    clearInterval(timer)
    navigator.usb?.removeEventListener('connect', onConnect)
  }
}

/** What the Flash press found plugged in. */
export type FoundBoard =
  { kind: 'dfu'; device: USBDevice } | { kind: 'bootloader'; board: HeldBoard } | { kind: 'none' }

/**
 * Find the board a Flash press is for, with as few choosers as the platform
 * allows. A board in DFU is a first flash; one that answers ArduPilot's
 * bootloader (rebooted into it from its firmware) is an update. The desktop app
 * sees both without asking, so it asks nothing, and finds nothing when neither
 * is plugged in, which is also how a blank board plugged in normally looks. A
 * browser sees only what it was granted before, so it shows the serial
 * chooser, then the DFU chooser if no bootloader answered.
 */
export async function detectBoard(onStep: (step: string) => void): Promise<FoundBoard> {
  onStep('Looking for the board…')
  const dfu = await grantedDfuDevice()
  if (dfu) return { kind: 'dfu', device: dfu }
  if (isElectron() && !(await grantedSerialPorts()).some(isArduPilotPort)) return { kind: 'none' }
  try {
    return { kind: 'bootloader', board: await identifyBoard({ reboot: true, onStep }) }
  } catch (e) {
    // The desktop app saw an ArduPilot port, so one that does not answer is
    // worth reporting. In a browser it is usually a canceled chooser, or a
    // blank board, which has no serial port.
    if (isElectron()) throw e
    const device = await chooseDfuDevice()
    return device ? { kind: 'dfu', device } : { kind: 'none' }
  }
}

/** Where an STM32's flash starts; an image for ROM DFU must start with a bootloader there. */
const FLASH_START = 0x08000000

/**
 * Write the bootloader and the firmware to a blank board over DFU, then leave
 * DFU, which starts the bootloader.
 */
export async function installBlank(
  release: CatalogRelease,
  option: FirmwareOption,
  device: USBDevice | undefined,
  onStep: (step: string) => void,
): Promise<void> {
  onStep('Downloading the firmware…')
  const bytes = await downloadCatalogFile(release, option.withBootloader)
  const segments = parseIntelHex(new TextDecoder().decode(bytes))
  // DFU erases what it writes, so an image without a bootloader would leave
  // the board with none.
  if (segments.length === 0 || Math.min(...segments.map((s) => s.address)) !== FLASH_START) {
    throw new Error(`${option.withBootloader.file} has no bootloader in it. Nothing was changed.`)
  }
  await flashDfu(segments, device)
}

/** How long ArduPilot's bootloader waits for an uploader before it starts the firmware. */
const BOOTLOADER_WAIT_MS = 5000

/** How often a wait for a port looks again. */
const PORT_POLL_MS = 250

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The ArduPilot ports this app may open without asking: every one in the desktop app. */
async function arduPilotPorts(): Promise<SerialPort[]> {
  return (await grantedSerialPorts()).filter(isArduPilotPort)
}

/**
 * ArduPilot's port once it has started on a board just written: the port that
 * is there after `previous` (the bootloader's, when known) has gone. Null on
 * timeout.
 *
 * No step that runs by itself may ask for a port: Chromium refuses
 * `requestPort()` without a recent press, so the request fails before the
 * desktop shell sees it. The ports are polled instead, which in the desktop app
 * lists every port; a browser lists only ports it was granted, so there this
 * usually times out and the caller asks for a press.
 *
 * After DFU (`previous` null) the bootloader's port comes first, with the same
 * USB ids, and MAVLink must not be sent to it. The first port seen is taken as
 * the bootloader's, unless it arrives after the bootloader's wait, when it can
 * only be ArduPilot's.
 */
export async function firmwarePort(
  previous: SerialPort | null,
  ms = 20000,
): Promise<SerialPort | null> {
  const start = Date.now()
  let bootloader = previous
  let gone = false
  while (Date.now() - start < ms) {
    const ports = await arduPilotPorts()
    if (!bootloader && ports.length === 1) {
      if (Date.now() - start > BOOTLOADER_WAIT_MS) return ports[0]!
      bootloader = ports[0]!
    } else if (bootloader && !gone && !ports.includes(bootloader)) {
      gone = true
    }
    // Whatever arrives once the bootloader has gone is ArduPilot, even if the
    // browser hands it back as the same object.
    if (gone && ports.length === 1) return ports[0]!
    await delay(PORT_POLL_MS)
  }
  return null
}

/** Get the connected board, or the one on a port the user picks, into its bootloader. */
async function enterBootloader(onStep: (step: string) => void): Promise<HeldBoard> {
  const live = useConnectionStore.getState().phase === 'connected'
  if (live) {
    onStep('Rebooting the board into its bootloader…')
    await rebootToBootloader()
  }
  return identifyBoard({ reboot: !live, rebooted: live, onStep })
}

/**
 * Write ArduPilot through the ArduPilot bootloader. A board running
 * ArduPilot on the live link is rebooted into its bootloader first, and one
 * on a port the user picks is rebooted there; one already in its bootloader
 * (`held`: found by `detectBoard`, or held by the Firmware card) is taken as
 * it is.
 *
 * The board comes before the download: a browser shows its port chooser only
 * within a few seconds of the press, and the download can take longer. A
 * board left in its bootloader waits there. Returns the bootloader's port,
 * which the board leaves when it starts the new firmware.
 */
export async function installFirmware(
  release: CatalogRelease,
  board: CatalogBoard,
  option: FirmwareOption,
  onStep: (step: string) => void,
  held?: HeldBoard,
  /** Send the board back to its firmware if nothing is written; the Firmware card keeps its own. */
  bootOnFailure = !held,
): Promise<SerialPort> {
  const found = held ?? (await enterBootloader(onStep))
  let apj: Awaited<ReturnType<typeof parseApj>>
  try {
    if (found.boardId !== board.boardId) {
      throw new Error(
        `This board reports board id ${found.boardId}, not ${board.name}. Nothing was changed.`,
      )
    }
    onStep('Downloading the firmware…')
    const bytes = await downloadCatalogFile(release, option)
    apj = await parseApj(new TextDecoder().decode(bytes))
    if (apj.boardId !== board.boardId) {
      throw new Error(
        `${option.file} is for board id ${apj.boardId}, not ${board.name}. Nothing was changed.`,
      )
    }
  } catch (e) {
    if (bootOnFailure) await bootBoard(found.port).catch(() => {})
    throw e
  }
  // The press that started the update is the confirmation.
  await flashSerial(apj, () => Promise.resolve(true), found.port)
  return found.port
}

/** ArduPilot's USB ids, shared by its bootloader and most boards' firmware. */
const ARDUPILOT_VID = 0x1209
const ARDUPILOT_PID = 0x5741

const isArduPilotPort = (p: SerialPort) => {
  const info = p.getInfo()
  return info.usbVendorId === ARDUPILOT_VID && info.usbProductId === ARDUPILOT_PID
}

/**
 * The next ArduPilot port to arrive that this app may open without asking:
 * the board coming back after a replug. Null on timeout or when `signal`
 * aborts. Only a port that was not there when the wait began counts, so one
 * that never went away is not mistaken for one that came back. Polled as well
 * as heard: the desktop app's `connect` events are not relied on.
 */
export function nextArduPilotPort(ms: number, signal?: AbortSignal): Promise<SerialPort | null> {
  const serial = typeof navigator !== 'undefined' ? navigator.serial : undefined
  if (!serial) return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    let before: SerialPort[] | null = null
    const done = (p: SerialPort | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      serial.removeEventListener('connect', onConnect)
      signal?.removeEventListener('abort', onAbort)
      resolve(p)
    }
    const onConnect = (e: Event) => {
      const port = (e as unknown as { target?: SerialPort }).target
      if (port && isArduPilotPort(port)) done(port)
    }
    const look = async () => {
      const ports = await arduPilotPorts()
      if (!before) before = ports
      else {
        const fresh = ports.find((p) => !before!.includes(p))
        if (fresh) done(fresh)
        // A port that went counts as new if it comes back.
        else before = before.filter((p) => ports.includes(p))
      }
    }
    const onAbort = () => done(null)
    const timer = setTimeout(() => done(null), ms)
    const poll = setInterval(() => void look(), PORT_POLL_MS)
    void look()
    serial.addEventListener('connect', onConnect)
    signal?.addEventListener('abort', onAbort)
  })
}

/** The one ArduPilot port this app may open without asking, if there is exactly one. */
export async function grantedArduPilotPort(): Promise<SerialPort | null> {
  const ports = await arduPilotPorts()
  return ports.length === 1 ? ports[0]! : null
}

/**
 * Connect MAVLink to the board and wait for its parameters. Without a port,
 * the desktop app picks the one new port itself and a browser shows its
 * chooser; both need a press just before, so a step that runs by itself
 * passes the port (`firmwarePort`).
 */
export async function connectArduPilot(port?: SerialPort): Promise<void> {
  let chosen = port
  if (!chosen) {
    window.loftgcs?.serialPicker.autoPickNew({ wait: true })
    chosen = await requestSerialPort()
  }
  await connectionService.connect({ kind: 'serial', baudRate: 115200, port: chosen })
  // `connect` reports a failure in the store rather than throwing.
  const failed = () => useConnectionStore.getState().phase === 'error'
  const ready = () =>
    useConnectionStore.getState().phase === 'connected' &&
    useParamStore.getState().loadState === 'ready'
  await until(() => failed() || ready(), 60000)
  if (failed()) throw new Error(useConnectionStore.getState().error ?? 'The connection failed.')
  if (!ready()) throw new Error('The flight controller did not answer over USB.')
}

/**
 * Update a board's firmware and connect to it again. False when the
 * firmware is written but the port did not come back by itself, which in a
 * browser takes a press on Connect.
 */
export async function updateFirmware(
  release: CatalogRelease,
  board: CatalogBoard,
  option: FirmwareOption,
  onStep: (step: string) => void,
  held?: HeldBoard,
  bootOnFailure = !held,
): Promise<boolean> {
  const bootloader = await installFirmware(release, board, option, onStep, held, bootOnFailure)
  onStep('Starting ArduPilot…')
  const port = await firmwarePort(bootloader)
  if (!port) return false
  onStep('Connecting…')
  await connectArduPilot(port)
  return true
}
