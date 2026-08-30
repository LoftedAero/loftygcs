// Flash orchestration: owns the bootloader-mode serial connection (separate
// from the MAVLink link) and the WebUSB DFU device, drives the protocol
// clients, and narrates into the flash store. The safety contract from the
// plan (R5): identify before erase, verify before reboot, and a wrong-board
// image is refused outright.
import { WebSerialTransport } from '../transport/web-serial'
import { ByteQueue, PxUploader, type BootloaderInfo } from '../protocol/bootloader/px-uploader'
import { DfuseFlasher, DFU_VENDOR_ID, DFU_PRODUCT_ID, type DfuDevice } from '../protocol/bootloader/dfu'
import type { ApjFirmware } from '../protocol/bootloader/apj'
import type { HexSegment } from '../protocol/bootloader/intel-hex'
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
  const result = await connectionService.runCommand(
    MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
    [3, 0, 0, 0, 0, 0, 0],
    5000,
  ).catch(() => -1) // some stacks reboot before acking; treat silence as sent
  store.appendLog(
    result === 0 ? 'vehicle acked reboot-to-bootloader' : 'reboot sent (no ack -- normal)',
  )
  await connectionService.disconnect()
}

/**
 * Flash an .apj over the ArduPilot serial bootloader. The user picks the
 * bootloader's port (it re-enumerates as a new device); `confirm` shows the
 * identified board and gates the erase.
 */
export async function flashSerial(
  apj: ApjFirmware,
  confirm: (info: BootloaderInfo) => Promise<boolean>,
): Promise<void> {
  const store = useFlashStore.getState()
  store.begin()
  const transport = new WebSerialTransport()
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
      useFlashStore.getState().setPhase('idle')
      useFlashStore.getState().appendLog('canceled before erase.')
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
function wrapUsbDevice(device: USBDevice, interfaceNumber: number, layout: string): DfuDevice {
  return {
    async controlOut(request, value, data) {
      const result = await device.controlTransferOut(
        { requestType: 'class', recipient: 'interface', request, value, index: interfaceNumber },
        data as BufferSource | undefined,
      )
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

/** Flash a with-bootloader hex image over the STM32 ROM bootloader (DFU). */
export async function flashDfu(segments: HexSegment[]): Promise<void> {
  const store = useFlashStore.getState()
  if (!('usb' in navigator)) {
    throw new Error('WebUSB is not available here. Use Chrome/Edge or the desktop app.')
  }
  store.begin()
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
    // ST encodes the flash sector layout in the interface name string;
    // without it we cannot know what to erase, so refuse rather than guess.
    const layout = iface.alternate.interfaceName ?? iface.alternates[0]?.interfaceName
    if (!layout || !layout.includes('/')) {
      throw new Error('DFU device did not report its flash layout; cannot flash safely.')
    }
    useFlashStore.getState().appendLog(`DFU layout: ${layout}`)

    const flasher = new DfuseFlasher(wrapUsbDevice(device, iface.interfaceNumber, layout), {
      onPhase: (p) => useFlashStore.getState().setPhase(p),
      onProgress: (pct) => useFlashStore.getState().setProgress(pct),
      onLog: (line) => useFlashStore.getState().appendLog(line),
    })
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
