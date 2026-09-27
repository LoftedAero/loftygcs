// Flash orchestration: owns the bootloader-mode serial connection (separate
// from the MAVLink link) and the WebUSB DFU device, drives the protocol
// clients, and reports into the flash store. Identify before erase, verify
// before reboot, and refuse a wrong-board image outright.
import {
  PortCancelledError,
  WebSerialTransport,
  grantedSerialPorts,
  requestSerialPort,
} from '../transport/web-serial'
import { ByteQueue, PxUploader, type BootloaderInfo } from '../protocol/bootloader/px-uploader'
import {
  DfuseFlasher,
  DFU_VENDOR_ID,
  DFU_PRODUCT_ID,
  parseDfuseLayout,
  type DfuDevice,
} from '../protocol/bootloader/dfu'
import type { ApjFirmware } from '../protocol/bootloader/apj'
import type { HexSegment } from '../protocol/bootloader/intel-hex'
import { encodeFrame } from '../protocol/frames'
import { useFlashStore } from '../stores/flash-store'
import { connectionService } from './connection'
import { useConnectionStore } from '../stores/connection-store'

const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246

/** Ask a connected vehicle to reboot into its bootloader, then free the port. */
export async function rebootToBootloader(): Promise<void> {
  const store = useFlashStore.getState()
  if (useConnectionStore.getState().phase !== 'connected') {
    throw new Error('not connected to a vehicle')
  }
  // param1 = 3: reboot autopilot and hold in bootloader.
  //
  // The ack rarely arrives because the vehicle reboots first, and
  // `runCommand` retries twice, so a short timeout keeps this from stalling.
  const result = await connectionService
    .runCommand(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, [3, 0, 0, 0, 0, 0, 0], 400)
    .catch(() => -1)
  store.appendLog(
    result === 0 ? 'vehicle acked reboot-to-bootloader' : 'reboot sent (no ack -- normal)',
  )
  await connectionService.disconnect()
}

/**
 * Put a board into its bootloader over a port the app is not connected to,
 * as a board plugged in to be flashed usually is.
 *
 * Writes MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN directly and does not wait for an
 * ack, as ArduPilot's `uploader.py` does. Broadcast ids (0/0) so it reaches
 * the vehicle whatever its system id.
 */
async function sendRebootOn(transport: WebSerialTransport): Promise<void> {
  const frame = encodeFrame(
    'COMMAND_LONG',
    {
      targetSystem: 0,
      targetComponent: 0,
      command: MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
      confirmation: 0,
      _param1: 3, // reboot the autopilot and hold it in the bootloader
      _param2: 0,
      _param3: 0,
      _param4: 0,
      _param5: 0,
      _param6: 0,
      _param7: 0,
    },
    0,
    255,
    0,
  )
  await transport.write(frame)
}

/**
 * Ask the board in bootloader mode what it is, and let go of the port.
 *
 * Uses `GET_DEVICE`/`BOARD_ID`, as Mission Planner does; it is the only
 * authoritative identifier. USB ids cannot stand in for it (the generic
 * ArduPilot pair `0x1209/0x5741` covers most boards), and the live link
 * cannot answer it because flashing is bootloader-only and the port
 * re-enumerates as a different device.
 *
 * `askForPort: false` is for background probes: `requestPort()` needs a user
 * gesture and shows a chooser, so without it only an already-granted port
 * (exactly one) is used. Only a user-initiated flash passes `true`.
 *
 * `reboot` handles a board running its firmware, which answers the
 * bootloader handshake with silence. Only the flash sets it; a background
 * probe must not reboot an aircraft.
 *
 * `attempts` defaults to 4 (about 2 s at 500 ms each) because a probe behind
 * the UI has to give up quickly, where the flash path keeps trying.
 *
 * The port is released before returning so the flash can open it.
 */
export async function identifyBoard({
  askForPort = true,
  attempts = 4,
  reboot = false,
  rebooted = false,
  onStep,
}: {
  askForPort?: boolean
  attempts?: number
  reboot?: boolean
  /** A reboot went out over the live link just before this; the board is mid-way back. */
  rebooted?: boolean
  /** What is happening now, in words meant for the screen. */
  onStep?: (step: string) => void
} = {}): Promise<BootloaderInfo & { port: SerialPort }> {
  const already = await grantedSerialPorts()
  // Exactly one, or there is no way to choose without guessing.
  const chosen = already.length === 1 ? already[0] : undefined
  if (!chosen && !askForPort) throw new Error('no port to read without asking')

  // Acquired once and shared by the probe and the reboot, so the chooser
  // appears at most once. Arming the shell's auto-pick first lets a board
  // already in its bootloader be taken without a chooser. It only waits if a
  // reboot just went out over the live link and the bootloader is still on
  // its way.
  if (!chosen) window.loftgcs?.serialPicker.autoPickNew({ wait: rebooted })
  const port = chosen ?? (await requestSerialPort())

  // Taken after the chooser, or the port just picked would look new to
  // `waitForNewPort` and be mistaken for the bootloader.
  const granted = await grantedSerialPorts()

  const readOnce = async (p: SerialPort | undefined, tries: number) => {
    const transport = new WebSerialTransport(p)
    try {
      await transport.open({ kind: 'serial', baudRate: 115200 })
      const link = new ByteQueue((b) => transport.write(b))
      transport.onData((b) => link.push(b))
      transport.onClose(() => link.push(new Uint8Array(0)))
      // No `onLog`: this can run in the background, and logging would open
      // the flash progress panel.
      const uploader = new PxUploader(link, {})
      await uploader.sync(tries)
      // Return the port so the flash reuses it instead of asking again.
      const used = transport.openedPort
      const info = await uploader.identify()
      if (!used) throw new Error('bootloader port was not open')
      return { ...info, port: used }
    } finally {
      await transport.close().catch(() => {})
    }
  }

  try {
    // Few attempts when a reboot can follow: a running autopilot stays
    // silent, and time spent here comes out of the gesture budget below.
    onStep?.('Looking for the bootloader…')
    return await readOnce(port, reboot ? 2 : attempts)
  } catch (err) {
    // Usually a running autopilot rather than a bootloader: reboot it.
    if (!reboot) throw err
  }

  // Tell the desktop shell the next port request is for the bootloader this
  // reboot creates, so it can answer without a chooser. No-op in the browser.
  window.loftgcs?.serialPicker.autoPickNew({ wait: true })

  onStep?.('Rebooting the board into its bootloader…')
  const nudge = new WebSerialTransport(port)
  try {
    await nudge.open({ kind: 'serial', baudRate: 115200 })
    await sendRebootOn(nudge)
  } catch {
    // If the port will not open, let the retry below report the error.
  } finally {
    await nudge.close().catch(() => {})
  }

  // The bootloader is a different USB device, so the autopilot's port and
  // grant do not carry over.
  //
  // In the browser, a fallback `requestPort()` needs the click to still
  // count as a user gesture, which lapses after about five seconds, so this
  // polls and returns as soon as the port appears (Betaflight caps the same
  // wait at four seconds). The desktop shell owns the chooser and can hold
  // the request open until the bootloader appears (electron/main.ts), so
  // there it asks at once.
  onStep?.('Waiting for the bootloader to appear…')
  const fresh = window.loftgcs ? undefined : await waitForNewPort(granted, 2500)

  // In the browser, a bootloader that never appeared would make
  // `readOnce(undefined)` show a second chooser, and cancelling it would be
  // silent. The reboot did go out, so report `RebootedError`, whose advice
  // (replug, then Detect board) works.
  if (!window.loftgcs && !fresh) throw new RebootedError()

  try {
    onStep?.('Reading the board id…')
    return await readOnce(fresh, attempts)
  } catch (err) {
    if (err instanceof PortCancelledError) throw err
    // Out of gesture, or nothing to pick. A replug puts the board back in its
    // bootloader briefly and the next press gets a fresh gesture.
    if (!fresh) throw new RebootedError()
    throw err
  }
}

/**
 * The board was rebooted but its bootloader could not be reached in time.
 * Not a board failure: the reboot almost certainly worked.
 */
export class RebootedError extends Error {
  constructor() {
    super('rebooted, but the bootloader was not reachable in time')
    this.name = 'RebootedError'
  }
}

/**
 * Wait for the bootloader's port to turn up, without asking for it.
 *
 * A `connect` event covers a device already granted to this origin that
 * re-enumerates (every flash after the first). `getPorts()` lists granted
 * ports whether or not they are present, so polling alone never sees it as
 * new. Polling covers a port newly granted elsewhere.
 *
 * Neither sees a device never granted to this origin; the caller then falls
 * back to a chooser.
 */
async function waitForNewPort(before: SerialPort[], ms: number): Promise<SerialPort | undefined> {
  const serial = typeof navigator !== 'undefined' ? navigator.serial : undefined
  let arrived: SerialPort | undefined
  const onConnect = (e: Event) => {
    const port = (e as unknown as { target?: SerialPort }).target
    if (port && !arrived) arrived = port
  }
  serial?.addEventListener('connect', onConnect)
  try {
    const deadline = Date.now() + ms
    for (;;) {
      if (arrived) return arrived
      const now = await grantedSerialPorts()
      const fresh = now.find((p) => !before.includes(p))
      if (fresh) return fresh
      if (Date.now() >= deadline) return undefined
      await new Promise((r) => setTimeout(r, 250))
    }
  } finally {
    serial?.removeEventListener('connect', onConnect)
  }
}

/**
 * Flash an .apj over the ArduPilot serial bootloader. The user picks the
 * bootloader's port (it re-enumerates as a new device); `confirm` shows the
 * identified board and gates the erase.
 */
export async function flashSerial(
  apj: ApjFirmware,
  confirm: (info: BootloaderInfo) => Promise<boolean>,
  port?: SerialPort,
): Promise<void> {
  const store = useFlashStore.getState()
  store.begin('serial')
  // Reuse the port `identifyBoard` found. With none (a file flashed with no
  // board identified first), the transport asks for one.
  const transport = new WebSerialTransport(port)
  try {
    await transport.open({ kind: 'serial', baudRate: 115200 })
    const link = new ByteQueue((b) => transport.write(b))
    transport.onData((b) => link.push(b))
    transport.onClose(() => link.push(new Uint8Array(0)))

    const uploader = new PxUploader(link, {
      onPhase: (p) => useFlashStore.getState().setPhase(p),
      onProgress: (pct) => useFlashStore.getState().setProgress(pct),
      onLog: (line) => useFlashStore.getState().appendLog(line),
    })

    await uploader.sync()
    const info = await uploader.identify()

    // The refusals that must cost nothing, in order: wrong board, image too
    // big, user said no. Nothing is erased before all three pass.
    if (info.boardId !== apj.boardId) {
      throw new Error(
        `firmware is for board id ${apj.boardId}, but this board reports ${info.boardId}. Nothing was changed.`,
      )
    }
    if (apj.image.length > info.fwSize) {
      throw new Error(
        `image (${apj.image.length} bytes) exceeds board flash (${info.fwSize} bytes). Nothing was changed.`,
      )
    }
    if (!(await confirm(info))) {
      // Left in its bootloader the board runs nothing until power-cycled.
      // Nothing was erased, so REBOOT jumps back to its current firmware.
      uploader.reboot()
      useFlashStore.getState().setPhase('idle')
      useFlashStore
        .getState()
        .appendLog('canceled before erase; board rebooting into its current firmware.')
      return
    }

    await uploader.erase()
    await uploader.program(apj.image)
    await uploader.verify(apj.image, info.fwSize)
    uploader.reboot()
    useFlashStore.getState().appendLog('flashed and verified; board rebooting.')
    useFlashStore.getState().finish()
  } catch (err) {
    useFlashStore.getState().fail(err instanceof Error ? err.message : 'flash failed')
    throw err
  } finally {
    await transport.close().catch(() => {})
  }
}

/** WebUSB adapter for the DfuseFlasher's narrow device interface. */
function wrapUsbDevice(
  device: USBDevice,
  interfaceNumber: number,
  layout: string,
  transferSize: number | null,
): DfuDevice {
  // An STM32 that stalls once latches into dfuERROR and refuses everything,
  // CLRSTATUS included, until power-cycled, so the message says to replug.
  // The browser's own error text goes to the flash log for diagnosis.
  const stalled = (err: unknown) => {
    useFlashStore
      .getState()
      .appendLog(`DFU stalled: ${err instanceof Error ? err.message : String(err)}`)
    return new Error(
      'The board stopped accepting DFU commands. Please reboot and reconnect it, still in DFU mode.',
    )
  }
  return {
    transferSize: transferSize ?? undefined,
    async controlOut(request, value, data) {
      const result = await device
        .controlTransferOut(
          { requestType: 'class', recipient: 'interface', request, value, index: interfaceNumber },
          data as BufferSource | undefined,
        )
        .catch((err) => {
          throw stalled(err)
        })
      if (result.status !== 'ok') throw new Error(`DFU control transfer ${request} failed`)
    },
    async controlIn(request, value, length) {
      const result = await device.controlTransferIn(
        { requestType: 'class', recipient: 'interface', request, value, index: interfaceNumber },
        length,
      )
      if (result.status !== 'ok' || !result.data) throw new Error(`DFU read ${request} failed`)
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    },
    memoryLayoutString: () => layout,
  }
}

/** What a board in ROM DFU can be made to say about itself. */
export interface DfuBoardInfo {
  productName: string | null
  vendorId: number
  productId: number
  /** The raw DfuSe descriptor, e.g. "@Internal Flash /0x08000000/16*128Kg". */
  layout: string
  startAddress: number
  totalBytes: number
  sectors: number
  /**
   * Runs of equal-sized sectors, as the descriptor writes them and
   * STM32CubeProgrammer prints them.
   */
  groups: { index: number; start: number; sectorSize: number; count: number }[]
}

/**
 * The DfuSe layout string for every alternate on a DFU interface, plus the
 * device's wTransferSize.
 *
 * ST encodes the memory map in the interface name, e.g. "@Internal Flash
 * /0x08000000/16*128Kg". `USBAlternateInterface.interfaceName` should carry
 * it, but Chromium on Windows returns null for a WinUSB-bound device. So,
 * like dfu-util, this reads the configuration descriptor, finds each
 * interface's `iInterface` index, and fetches those string descriptors:
 *
 *     alt 0  ->  "@Internal Flash   /0x08000000/16*128Kg"
 *     alt 1  ->  "@Option Bytes     /0x5200201C/01*128 e"
 *
 * `interfaceName` is used when the browser provides it.
 */
async function dfuDescriptors(
  device: USBDevice,
  iface: USBInterface,
): Promise<{ names: Map<number, string>; transferSize: number | null }> {
  const named = new Map<number, string>()
  for (const a of iface.alternates) {
    if (a.interfaceName) named.set(a.alternateSetting, a.interfaceName)
  }

  const GET_DESCRIPTOR = 6
  const CONFIGURATION = 2
  const STRING = 3
  const desc = async (type: number, index: number, length: number, langId = 0) => {
    const r = await device.controlTransferIn(
      {
        requestType: 'standard',
        recipient: 'device',
        request: GET_DESCRIPTOR,
        value: (type << 8) | index,
        index: langId,
      },
      length,
    )
    return r.status === 'ok' && r.data ? new Uint8Array(r.data.buffer) : null
  }

  // wTotalLength first: the configuration descriptor is followed by every
  // interface and endpoint descriptor, and only the header says how far.
  const head = await desc(CONFIGURATION, 0, 9)
  if (!head || head.length < 4) return { names: named, transferSize: null }
  const full = await desc(CONFIGURATION, 0, head[2]! | (head[3]! << 8))
  if (!full) return { names: named, transferSize: null }

  // Walk it. An interface descriptor is type 4, and its `iInterface` string
  // index is the ninth byte; alternates are separate descriptors sharing an
  // interface number.
  const wanted = new Map<number, number>() // alternateSetting -> string index
  // The DFU functional descriptor (type 0x21) rides in the same block, and
  // its wTransferSize is the largest DNLOAD this device will accept.
  let transferSize: number | null = null
  for (let i = 0; i + 1 < full.length;) {
    const len = full[i]!
    if (len === 0) break
    if (full[i + 1] === 4 && full[i + 2] === iface.interfaceNumber) {
      const strIndex = full[i + 8]!
      if (strIndex !== 0) wanted.set(full[i + 3]!, strIndex)
    }
    if (full[i + 1] === 0x21 && len >= 7) transferSize = full[i + 5]! | (full[i + 6]! << 8)
    i += len
  }
  if (named.size === iface.alternates.length) return { names: named, transferSize }

  // String descriptor 0 is the list of supported languages, not a string.
  const langs = await desc(STRING, 0, 255)
  const langId = langs && langs.length >= 4 ? langs[2]! | (langs[3]! << 8) : 0x0409
  const decoder = new TextDecoder('utf-16le')
  for (const [alt, strIndex] of wanted) {
    if (named.has(alt)) continue
    const raw = await desc(STRING, strIndex, 255, langId)
    // A string descriptor is [bLength, bDescriptorType, ...UTF-16LE]; bLength
    // counts the header, so a decode of the whole buffer trails garbage.
    if (raw && raw.length > 2) named.set(alt, decoder.decode(raw.subarray(2, raw[0]!)))
  }
  return { names: named, transferSize }
}

/**
 * Ask a board in DFU mode what it is, and let go of it.
 *
 * This does not identify the board: every STM32 in ROM DFU is 0483:DF11, and
 * the serial number is the chip's unique id. The flash geometry narrows the
 * MCU (enough to catch an F4 image aimed at an H7), not the board, so the
 * target is the user's choice.
 *
 * `askForPort: false` uses only devices already granted (`getDevices()`), so
 * a background check never raises the device chooser.
 */
export async function identifyDfu({
  askForPort = true,
}: { askForPort?: boolean } = {}): Promise<DfuBoardInfo> {
  if (!('usb' in navigator)) {
    throw new Error('WebUSB is not available here. Use Chrome/Edge or the desktop app.')
  }
  const filters = [{ vendorId: DFU_VENDOR_ID, productId: DFU_PRODUCT_ID }]
  const granted = await navigator.usb.getDevices().catch(() => [] as USBDevice[])
  const already = granted.find(
    (d) => d.vendorId === DFU_VENDOR_ID && d.productId === DFU_PRODUCT_ID,
  )
  if (!already && !askForPort) throw new Error('no DFU device to read without asking')
  const device = already ?? (await navigator.usb.requestDevice({ filters }))
  try {
    await device.open()
    if (device.configuration === null) await device.selectConfiguration(1)
    const iface = device.configuration?.interfaces[0]
    if (!iface) throw new Error('This DFU device exposes no interface.')
    const { names } = await dfuDescriptors(device, iface)
    const layout = [...names.values()].find((n) => n.startsWith('@Internal Flash'))
    if (!layout) {
      const seen = [...names.values()].join(', ')
      throw new Error(
        `This DFU device reports no internal flash${seen ? ` (it offers ${seen})` : ''}.`,
      )
    }
    const sectors = parseDfuseLayout(layout)
    const groups: DfuBoardInfo['groups'] = []
    sectors.forEach((s, i) => {
      const last = groups[groups.length - 1]
      if (last && last.sectorSize === s.sectorSize) last.count++
      else groups.push({ index: i, start: s.start, sectorSize: s.sectorSize, count: 1 })
    })
    return {
      productName: device.productName ?? null,
      vendorId: device.vendorId,
      productId: device.productId,
      layout,
      startAddress: sectors[0]?.start ?? 0,
      totalBytes: sectors.reduce((n, s) => n + (s.end - s.start), 0),
      sectors: sectors.length,
      groups,
    }
  } finally {
    // Released before returning: the flash that follows opens its own.
    await device.close().catch(() => {})
  }
}

/**
 * Send a board waiting in its bootloader back to its firmware. A board
 * identified over serial is otherwise left running nothing. The bootloader's
 * REBOOT jumps to the application it still has.
 */
export async function bootBoard(port: SerialPort): Promise<void> {
  const transport = new WebSerialTransport(port)
  try {
    await transport.open({ kind: 'serial', baudRate: 115200 })
    const link = new ByteQueue((b) => transport.write(b))
    transport.onData((b) => link.push(b))
    transport.onClose(() => link.push(new Uint8Array(0)))
    const uploader = new PxUploader(link, {})
    await uploader.sync(2)
    uploader.reboot()
    // Let the byte leave before the port closes under it.
    await new Promise((r) => setTimeout(r, 150))
  } finally {
    await transport.close().catch(() => {})
  }
}

/** Flash a with-bootloader hex image over the STM32 ROM bootloader (DFU). */
export async function flashDfu(segments: HexSegment[]): Promise<void> {
  const store = useFlashStore.getState()
  if (!('usb' in navigator)) {
    throw new Error('WebUSB is not available here. Use Chrome/Edge or the desktop app.')
  }
  store.begin('dfu')
  let device: USBDevice | null = null
  try {
    device = await navigator.usb
      .requestDevice({ filters: [{ vendorId: DFU_VENDOR_ID, productId: DFU_PRODUCT_ID }] })
      .catch(() => {
        throw new Error(
          'No DFU device selected. Hold BOOT0 (or bridge the DFU pads) while plugging USB in, then retry. On Windows the device also needs the WinUSB driver (Zadig).',
        )
      })
    await device.open()
    if (device.configuration === null) await device.selectConfiguration(1)
    const iface = device.configuration?.interfaces[0]
    if (!iface) throw new Error('DFU device exposes no interface')
    await device.claimInterface(iface.interfaceNumber)

    // Select the flash alternate explicitly rather than using whichever the
    // device came up on. An STM32 in ROM DFU also exposes `@Option Bytes`,
    // `@OTP Memory` and `@Device Feature`; OTP is one-time programmable and
    // the option bytes decide whether the chip boots.
    const { names, transferSize } = await dfuDescriptors(device, iface)
    const flash = [...names].find(([, n]) => n.startsWith('@Internal Flash'))
    if (!flash) {
      const seen = [...names.values()].join(', ') || '(none reported)'
      throw new Error(
        `This DFU device exposes no internal flash to write to (${seen}). Refusing to flash.`,
      )
    }
    await device.selectAlternateInterface(iface.interfaceNumber, flash[0])
    // ST encodes the flash sector layout in the interface name string;
    // without it we cannot know what to erase, so refuse rather than guess.
    const layout = flash[1]
    if (!layout.includes('/')) {
      throw new Error('DFU device did not report its flash layout; cannot flash safely.')
    }
    useFlashStore.getState().appendLog(`DFU layout: ${layout}`)

    // DFU offers no board id, so the only automatic check is that the image
    // fits the reported flash. One that does not is for a different MCU.
    const limit = parseDfuseLayout(layout).reduce((end, s) => Math.max(end, s.end), 0)
    const top = segments.reduce((end, s) => Math.max(end, s.address + s.data.length), 0)
    if (top > limit) {
      throw new Error(
        `This image needs flash up to 0x${top.toString(16)} and the board only has it to ` +
          `0x${limit.toString(16)} — it is built for a different board. Nothing was erased.`,
      )
    }

    const flasher = new DfuseFlasher(
      wrapUsbDevice(device, iface.interfaceNumber, layout, transferSize),
      {
        onPhase: (p) => useFlashStore.getState().setPhase(p),
        onProgress: (pct) => useFlashStore.getState().setProgress(pct),
        onLog: (line) => useFlashStore.getState().appendLog(line),
      },
    )
    await flasher.flash(segments)
    useFlashStore.getState().appendLog('DFU flash complete; board should boot.')
    useFlashStore.getState().finish()
  } catch (err) {
    useFlashStore.getState().fail(err instanceof Error ? err.message : 'DFU flash failed')
    throw err
  } finally {
    await device?.close().catch(() => {})
  }
}
