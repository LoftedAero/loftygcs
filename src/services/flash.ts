// Flash orchestration: owns the bootloader-mode serial connection (separate
// from the MAVLink link) and the WebUSB DFU device, drives the protocol
// clients, and narrates into the flash store. The safety contract from the
// plan (R5): identify before erase, verify before reboot, and a wrong-board
// image is refused outright.
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
  // The ack almost never comes -- the vehicle obeys before it answers -- and
  // `runCommand` retries twice, so at the default timeout this sat on
  // "Rebooting…" for fifteen seconds waiting for a reply from a board that
  // was already in its bootloader. A short timeout costs two harmless
  // repeats of a command the board has already acted on.
  const result = await connectionService
    .runCommand(MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, [3, 0, 0, 0, 0, 0, 0], 400)
    .catch(() => -1)
  store.appendLog(
    result === 0 ? 'vehicle acked reboot-to-bootloader' : 'reboot sent (no ack -- normal)',
  )
  await connectionService.disconnect()
}

/**
 * Put a board into its bootloader over a port we are not connected to.
 *
 * `rebootToBootloader` above goes through `connectionService` and so needs
 * the app to be flying the thing already. On the Firmware tab it usually is
 * not -- a board plugged in to be flashed is a board nobody connected to --
 * and the flash path skipped the reboot entirely in that case, then reported
 * that the board would not identify itself. It was running its firmware
 * perfectly well; nothing had asked it to stop.
 *
 * So this writes the same MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN straight down an
 * open port and does not wait for an ack: the vehicle reboots when it obeys,
 * which means the ack usually never arrives, and ArduPilot's own
 * `uploader.py` sends it blind for the same reason. Broadcast ids (0/0) so
 * it lands whatever the vehicle numbered itself.
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
 * This is the whole of Mission Planner's board detection: `GET_DEVICE` with
 * `BOARD_ID`, which is the *only* authoritative identifier either app has.
 * Two things it deliberately does not use, both checked against the live
 * manifest rather than assumed:
 *
 *  - **AUTOPILOT_VERSION.** A running vehicle reports vendor and product
 *    ids, and Mission Planner never consults them for this. Nor could it
 *    usefully: there are 44 distinct USBIDs in the manifest against 317
 *    board ids, and the generic ArduPilot pair `0x1209/0x5741` alone covers
 *    18,551 rows. A board resolved from USB ids is not resolved.
 *  - **The live link.** ArduPilot's flash path is bootloader-only, so the
 *    board has to be rebooted into it first (`rebootToBootloader`) and the
 *    port re-enumerates as a different device on the way -- which is why
 *    this asks for a port rather than reusing one.
 *
 * **`askForPort` separates work the screen starts by itself from work
 * somebody asked for.** Opening a serial port needs `requestPort()`, which
 * needs a user gesture *and* shows a chooser; the one exception is a port
 * already granted, which `getPorts()` hands over with neither. So the probe
 * behind the vehicle click passes `false` and gives up unless exactly one
 * port is already granted, and the flash -- which somebody pressed -- passes
 * `true`. Measured rather than reasoned about: driven headless, an earlier
 * version popped the chooser on every click of a vehicle symbol and sat on
 * "Checking the board..." until it was answered.
 *
 * **`reboot` is what makes the flash path work on a board nobody connected
 * to.** A flight controller plugged in to be flashed is normally running its
 * firmware, and a running autopilot answers the bootloader handshake with
 * silence -- so without this, a perfectly healthy Cube reported that it
 * would not identify itself. Only the flash sets it: a probe running behind
 * the screen must not reboot somebody's aircraft to satisfy its curiosity.
 *
 * `attempts` is 4 rather than the flash path's 10 because the two want
 * opposite things from a silent port: a flash should keep knocking through
 * a board still printing its banner, where a probe behind a UI has to give
 * up. At 500 ms a knock that is 2 seconds, not 5.
 *
 * The port is released before returning: the flash that follows opens its
 * own, and holding this one would make the board unreachable to it.
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
  // Exactly one, or there is nothing to pick between without guessing.
  const chosen = already.length === 1 ? already[0] : undefined
  if (!chosen && !askForPort) throw new Error('no port to read without asking')

  // Acquired **once**, before anything opens it. The probe and the reboot
  // want the same device, and letting each transport ask for its own put the
  // same chooser up twice for the same board.
  // Before the first ask too: a board already sitting in its bootloader --
  // a fresh plug-in, or a flash that was cancelled at the confirm -- is the
  // one port on the machine that says so, and the shell can take it without
  // showing anybody a list. No hold here: if it is not obvious the chooser
  // should appear at once, not after a pause.
  //
  // Unless a reboot has just gone out over the live link -- then the board
  // is mid-way back as its bootloader, and this ask needs the same short
  // hold the post-reboot ask gets. Measured: without it the chooser flashed
  // up for a second and a half and closed itself when the bootloader landed.
  if (!chosen) window.loftgcs?.serialPicker.autoPickNew({ wait: rebooted })
  const port = chosen ?? (await requestSerialPort())

  // The "before" set is taken *after* the chooser, on purpose. Taken before
  // it, the port just picked was the newest grant on the machine and so the
  // first thing `waitForNewPort` returned -- the running autopilot, handed
  // back as if it were the bootloader, which then failed the handshake and
  // read as a board that could not be identified.
  const granted = await grantedSerialPorts()

  const readOnce = async (p: SerialPort | undefined, tries: number) => {
    const transport = new WebSerialTransport(p)
    try {
      await transport.open({ kind: 'serial', baudRate: 115200 })
      const link = new ByteQueue((b) => transport.write(b))
      transport.onData((b) => link.push(b))
      transport.onClose(() => link.push(new Uint8Array(0)))
      // No `onLog`: this can run on its own behind the screen, and narrating
      // it into the flash log would open the progress panel unbidden.
      const uploader = new PxUploader(link, {})
      await uploader.sync(tries)
      // The port goes back with the id: the flash that follows must use this
      // same port, not ask for one -- see flashSerial.
      const used = transport.openedPort
      const info = await uploader.identify()
      if (!used) throw new Error('bootloader port was not open')
      return { ...info, port: used }
    } finally {
      await transport.close().catch(() => {})
    }
  }

  try {
    // A short knock when a reboot can follow: a running autopilot answers
    // this with silence, and every attempt spent waiting for it comes out of
    // the gesture budget below.
    onStep?.('Looking for the bootloader…')
    return await readOnce(port, reboot ? 2 : attempts)
  } catch (err) {
    // The ordinary case, not a fault: the port answered but it is a running
    // autopilot rather than a bootloader. Ask it to reboot into one.
    if (!reboot) throw err
  }

  // Tell the desktop shell that the next port request is for the bootloader
  // this reboot is about to create, so it can answer from the list Chromium
  // hands it instead of putting a chooser up. A no-op in the browser, where
  // the page never sees that list.
  window.loftgcs?.serialPicker.autoPickNew({ wait: true })

  onStep?.('Rebooting the board into its bootloader…')
  const nudge = new WebSerialTransport(port)
  try {
    await nudge.open({ kind: 'serial', baudRate: 115200 })
    await sendRebootOn(nudge)
  } catch {
    // If the port will not even open there is nothing to reboot; fall
    // through and let the retry below produce the real error.
  } finally {
    await nudge.close().catch(() => {})
  }

  // The board re-enumerates as its bootloader, which is a *different* USB
  // device -- so the port opened above is gone, and a port granted for the
  // autopilot does not cover the bootloader.
  //
  // **All of this is a race against the click.** Falling back to
  // `requestPort()` needs the press of Flash to still count as a user
  // gesture, and browsers stop counting it after about five seconds. So this
  // polls rather than sleeping a fixed time -- it leaves the moment the port
  // appears -- and the knock above it is short for the same reason.
  // Betaflight caps the equivalent wait at four seconds and its source says
  // why, in those words.
  //
  // The desktop shell is different, and better: its main process owns the
  // chooser and is told by Chromium the moment a port appears, so it can
  // hold the request open and answer it with the bootloader itself
  // (electron/main.ts). There, the right move is to ask at once, while the
  // gesture is fresh, and let the shell wait.
  onStep?.('Waiting for the bootloader to appear…')
  const fresh = window.loftgcs ? undefined : await waitForNewPort(granted, 2500)

  // In the browser there is no shell to answer for us, so a bootloader that
  // never turned up leaves nothing to open -- and `readOnce(undefined)` would
  // then put a **second** chooser in front of someone who has already picked
  // a port. That dialog is doubly misleading: the board has rebooted by the
  // time it appears, so its MAVLINK and SLCAN ports are genuinely gone from
  // the list, and dismissing it raises `PortCancelledError`, which the screen
  // reads as "chose not to continue" and so says nothing at all. A wrong port
  // therefore failed in silence. The reboot did go out, so this is
  // `RebootedError`'s case, and its advice -- unplug, plug back in, press
  // Detect board -- is the advice that works, for the wrong port as much as
  // for a slow one.
  if (!window.loftgcs && !fresh) throw new RebootedError()

  try {
    onStep?.('Reading the board id…')
    return await readOnce(fresh, attempts)
  } catch (err) {
    if (err instanceof PortCancelledError) throw err
    // Out of gesture, or nothing there to pick. Mission Planner's advice is
    // the right advice here and worth passing on: a replug puts the board
    // back in its bootloader for a few seconds *and* gives the next press a
    // fresh gesture to open the chooser with.
    if (!fresh) throw new RebootedError()
    throw err
  }
}

/**
 * The board was rebooted and its bootloader could not be reached in time.
 *
 * Its own type because the screen has something specific and useful to say
 * about it, and because it is *not* a failure of the board -- the reboot
 * almost certainly worked.
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
 * Two ways it can arrive, and both are needed.
 *
 * **A `connect` event** fires when a device this origin has *already* been
 * granted is plugged in or re-enumerates -- which is what happens on every
 * flash after the first, because the grant persists. Polling `getPorts()`
 * alone misses this case entirely: that call lists granted ports whether or
 * not the device is currently present, so the bootloader is in the "before"
 * list too and never looks new. Without this listener the second flash of a
 * board prompts exactly as often as the first.
 *
 * **A newly granted port**, for the first time, when the user has just
 * answered a chooser elsewhere.
 *
 * Neither fires for a device this origin has never been granted -- that is
 * the browser's privacy line, and the caller falls back to a chooser.
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
  // On the port `identifyBoard` found, when there is one. Opening a fresh
  // transport with no port was a third chooser on every flash: the trace
  // showed the bootloader found and the request answered automatically,
  // then this line asking again. With no port given -- a file flashed
  // with nothing identified first -- it asks, which is right.
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
      // Cancel means "as you were": the board was rebooted into its
      // bootloader to get here, and left there it sits with no firmware
      // running until somebody power-cycles it -- which is what happened on
      // the bench. REBOOT makes the bootloader jump to the app it already
      // has. Nothing was erased, so there is one to jump to.
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
  // A stalled control transfer reaches the screen as "Failed to execute
  // 'controlTransferOut' on 'USBDevice': A transfer error has occurred",
  // which names the API rather than the situation. What has happened is that
  // the board stopped answering: an STM32 that stalls once latches into
  // dfuERROR and refuses everything after it, CLRSTATUS included, until its
  // power is cycled -- measured on the bench. So the only useful instruction
  // is the physical one.
  const stalled = (err: unknown) =>
    new Error(
      `The board stopped accepting DFU commands (${
        err instanceof Error ? err.message : String(err)
      }). Unplug it, hold BOOT while plugging it back in, then detect it again.`,
    )
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
   * Runs of equal-sized sectors, which is how the descriptor itself is
   * written and how STM32CubeProgrammer prints it -- one row per group
   * rather than one per sector, so an H743's 16 sectors are a line and a
   * board with 998 of them is still readable.
   */
  groups: { index: number; start: number; sectorSize: number; count: number }[]
}

/**
 * Ask a board in DFU mode what it is, and let go of it.
 *
 * **None of this identifies the board**, and the screen has to say so. Every
 * STM32 in ROM DFU is 0483:DF11 whatever it is soldered to, and the serial
 * number is the chip's unique id, not a model. What the device does report is
 * its flash geometry, which narrows the *MCU* -- enough to catch an F4 image
 * aimed at an H7 board, and nowhere near enough to tell a MatekH743 from a
 * CubeOrange. The ArduPilot serial bootloader's board-id handshake has no
 * equivalent here; picking the right target is the user's assertion.
 *
 * `askForPort` splits the same way the serial probe does: `getDevices()`
 * returns what this origin was already granted and prompts for nothing, so
 * the automatic check is silent, and only the button someone pressed is
 * allowed to raise Chrome's device chooser.
 */
/**
 * The DfuSe layout string for every alternate on a DFU interface.
 *
 * ST encodes the memory map in the *interface name* -- "@Internal Flash
 * /0x08000000/16*128Kg" -- and it is the only way to know which region an
 * alternate writes and what its sectors are. `USBAlternateInterface.
 * interfaceName` is supposed to carry it, and on the bench **it is null**:
 * measured in this app's own renderer against an H7 in ROM DFU, WinUSB-bound
 * and otherwise perfectly healthy, both alternates came back
 * `{name: null, cls: 254}`. Every DFU feature reads that string, so the whole
 * path failed on a board that was sitting right there.
 *
 * So the strings are read the way dfu-util reads them, which needs no help
 * from the browser: fetch the configuration descriptor, walk it for each
 * interface descriptor's `iInterface` index, and ask for those string
 * descriptors. Same device, same two alternates, names in hand:
 *
 *     alt 0  ->  "@Internal Flash   /0x08000000/16*128Kg"
 *     alt 1  ->  "@Option Bytes     /0x5200201C/01*128 e"
 *
 * -- which is also the sharpest possible argument for selecting the alternate
 * by name rather than taking the one the device came up on: the neighbour of
 * the flash region is the register that decides whether the chip boots.
 *
 * `interfaceName` is still preferred when the browser does fill it in; this
 * runs only when it does not, and a device that answers neither is reported
 * rather than guessed at.
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
 * Send a board that is waiting in its bootloader back to its firmware.
 *
 * A board identified over serial is left sitting in its bootloader, running
 * nothing, until it is flashed or told to boot. "Change board" and leaving
 * the Firmware screen both call this so that the board someone walked away
 * from is a board running its firmware, not one waiting for a power cycle.
 * The bootloader's REBOOT jumps to the application it still has.
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

    // Pick the program-flash alternate *explicitly*, and never write to
    // whichever one the device happened to come up on. An STM32 in ROM DFU
    // exposes several -- ArduPilot's own `dfu-util --list` output shows
    // `@Internal Flash`, `@Option Bytes`, `@OTP Memory` and
    // `@Device Feature` on one board -- and two of them are worse than a
    // wrong firmware: OTP is one-time programmable, and the option bytes
    // decide whether the chip boots at all. This used to read
    // `iface.alternate` and never call `selectAlternateInterface`, which
    // left the region being written up to the device.
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

    // The one automatic check this path can make. DFU offers no board id --
    // every STM32 in ROM DFU is 0483:DF11 whatever board it is soldered to --
    // so the target is the user's assertion and nothing here can confirm it.
    // What the device *does* report is how much flash it has, and an image
    // running off the end of it is a wrong-MCU image caught before anything
    // is erased.
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
