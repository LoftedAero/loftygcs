// Builds the four ExpressLRS images for an ESP32 receiver the way ExpressLRS
// itself does, so no Python and no ExpressLRS Configurator are needed:
// `src/python/binary_configurator.py` and `UnifiedConfiguration.py` in the
// ExpressLRS repository, and their JavaScript port in the ExpressLRS web
// flasher. A unified build is one firmware.bin for many receivers; the
// receiver's identity, its options (binding phrase among them) and its pin
// layout are appended after the ESP image, where the firmware reads them at
// boot:
//
//     ESP image | product name (128) | lua name (16) | options JSON (512) | layout JSON (2048)
//
// Every field is NUL padded and cut to its size.

/** Flash offsets of an ESP32-C3 build (esptool's write_flash arguments). */
export const ESP32C3_IMAGES = [
  { address: 0x0, name: 'bootloader.bin' },
  { address: 0x8000, name: 'partitions.bin' },
  { address: 0xe000, name: 'boot_app0.bin' },
  { address: 0x10000, name: 'firmware.bin' },
] as const

/** `esp_image_header_t.chip_id` for the ESP32-C3. */
export const ESP32C3_CHIP_ID = 5

const ESP_IMAGE_MAGIC = 0xe9

/**
 * The chip an ESP image is built for, or null when the bytes are not an ESP
 * image. The extended header after the 8-byte common header carries it.
 */
export function espImageChip(image: Uint8Array): number | null {
  if (image.length < 24 || image[0] !== ESP_IMAGE_MAGIC) return null
  return image[12]! | (image[13]! << 8)
}

/**
 * Where the ESP image inside a firmware.bin ends: after its segments,
 * rounded up past the checksum byte to 16, then past the 32-byte SHA-256
 * every ESP32 image carries. Ported from `findFirmwareEnd`.
 */
export function espImageEnd(image: Uint8Array): number {
  if (image[0] !== ESP_IMAGE_MAGIC) throw new Error('firmware.bin is not an ESP image')
  let segments = image[1]!
  let pos = 24
  while (segments-- > 0) {
    if (pos + 8 > image.length) throw new Error('firmware.bin is truncated')
    const size =
      image[pos + 4]! | (image[pos + 5]! << 8) | (image[pos + 6]! << 16) | (image[pos + 7]! << 24)
    pos += 8 + (size >>> 0)
  }
  pos = (pos + 16) & ~15
  pos += 32
  if (pos > image.length) throw new Error('firmware.bin is truncated')
  return pos
}

const encoder = new TextEncoder()

function field(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size)
  out.set(encoder.encode(text).subarray(0, size))
  return out
}

/** What `targets.json` says about one receiver. */
export interface ElrsTargetConfig {
  product_name: string
  lua_name: string
  layout_file: string
  overlay?: Record<string, unknown>
  platform: string
  firmware: string
  min_version?: string
}

/** The receiver options this app writes; the rest keep ExpressLRS's defaults. */
export interface ElrsRxOptions {
  uid: Uint8Array | null
  /** Seconds after power-up without a link before the receiver starts its WiFi. */
  wifiOnInterval: number
  /** CRSF baud to the flight controller; must match the flight controller's (RC_OPTIONS bit 13 is 420000). */
  uartBaud: number
  lockOnFirstConnection: boolean
  /** A random nonzero word that lets the receiver tell one flash from the next. */
  flashDiscriminator: number
}

/** The options JSON the firmware reads, with ExpressLRS's key names. */
export function optionsJson(o: ElrsRxOptions): string {
  const json: Record<string, unknown> = { 'flash-discriminator': o.flashDiscriminator }
  if (o.uid) json.uid = [...o.uid]
  json['wifi-on-interval'] = o.wifiOnInterval
  json['rcvr-uart-baud'] = o.uartBaud
  json['lock-on-first-connection'] = o.lockOnFirstConnection
  return JSON.stringify(json)
}

/**
 * The firmware.bin to write: the release's image with this receiver's
 * identity, options and layout appended. Anything the release image already
 * carried after the ESP image is replaced, as ExpressLRS does.
 */
export function configureFirmware(
  image: Uint8Array,
  target: ElrsTargetConfig,
  layout: Record<string, unknown>,
  options: ElrsRxOptions,
): Uint8Array {
  const end = espImageEnd(image)
  const merged = { ...layout, ...(target.overlay ?? {}) }
  const parts = [
    image.subarray(0, end),
    field(target.product_name, 128),
    field(target.lua_name, 16),
    field(optionsJson(options), 512),
    field(JSON.stringify(merged), 2048),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Compare dotted versions numerically ("3.10.0" is after "3.9.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0)
  const pb = b.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
