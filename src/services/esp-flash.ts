// esptool over a Web Serial port, through Espressif's esptool-js. The resets
// are done by the caller (through the flight controller's relays on a
// Lofted Aero board), so the loader neither toggles DTR/RTS nor resets the
// chip afterwards: through ArduPilot's passthrough those lines do nothing.

import { ESPLoader, Transport, type IEspLoaderTerminal } from 'esptool-js'
import { md5 } from '../protocol/elrs/uid'
import type { EspImage } from './elrs-firmware'

/** The passthrough copies the USB line coding to the receiver's UART; the ROM loader starts at 115200. */
const BAUD = 115200

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** The ROM's reply when the port is held by another program, cleaned for the screen. */
function describeOpenError(err: unknown): Error {
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : String(err)
  if (name === 'NetworkError' || name === 'InvalidStateError' || /open/i.test(message)) {
    return new Error('Another program has the serial port open. Close it and try again.')
  }
  return err instanceof Error ? err : new Error(message)
}

/**
 * Write the images to an ESP32-C3 already waiting in its ROM loader, and
 * verify each against its MD5. Progress is 0-100 over all images.
 */
export async function writeEspImages(
  port: SerialPort,
  images: EspImage[],
  onProgress?: (pct: number) => void,
  onLog?: (line: string) => void,
): Promise<void> {
  const terminal: IEspLoaderTerminal = {
    clean: () => {},
    writeLine: (line) => onLog?.(line),
    write: () => {},
  }
  const transport = new Transport(port, false)
  const loader = new ESPLoader({ transport, baudrate: BAUD, romBaudrate: BAUD, terminal })
  const total = images.reduce((n, f) => n + f.data.length, 0)
  const before = images.map((_, i) => images.slice(0, i).reduce((n, f) => n + f.data.length, 0))
  try {
    let chip: string
    try {
      chip = await loader.main('no_reset')
    } catch (e) {
      throw describeOpenError(e)
    }
    if (!/ESP32-C3/i.test(chip))
      throw new Error(`The receiver answered as an ${chip}, not an ESP32-C3.`)
    await loader.writeFlash({
      fileArray: images.map((f) => ({ data: f.data, address: f.address })),
      flashMode: 'dio',
      flashFreq: 'keep',
      flashSize: 'detect',
      eraseAll: false,
      compress: true,
      // `written` counts the image's own bytes, so progress is by image size.
      reportProgress: (i, written, size) =>
        onProgress?.(
          Math.min(
            100,
            Math.round((100 * (before[i]! + (written / size) * images[i]!.data.length)) / total),
          ),
        ),
      calculateMD5Hash: (image) => hex(md5(image)),
    })
    await loader.after('no_reset')
  } finally {
    await transport.disconnect().catch(() => {})
  }
}
