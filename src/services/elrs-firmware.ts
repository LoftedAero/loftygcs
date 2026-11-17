// ExpressLRS receiver firmware, taken from the files ExpressLRS publishes for
// its own web flasher (expresslrs.github.io/web-flasher). That host sends
// CORS headers, so the browser build can read it; ExpressLRS Configurator's
// artifact server does not. The layout is the web flasher's:
//
//     assets/firmware/index.json                     { tags: { "3.6.3": <commit> }, branches: {...} }
//     assets/firmware/hardware/targets.json          every receiver, by vendor.type.model
//     assets/firmware/hardware/RX/<layout_file>      a receiver's pin layout
//     assets/firmware/<commit>/<FCC|LBT>/<firmware>/{bootloader,partitions,boot_app0,firmware}.bin
//
// It is that site's internal layout rather than a published interface, so a
// missing file is reported as such rather than guessed around.

import { bindingUid } from '../protocol/elrs/uid'
import {
  compareVersions,
  configureFirmware,
  ESP32C3_CHIP_ID,
  ESP32C3_IMAGES,
  espImageChip,
  type ElrsTargetConfig,
} from '../protocol/elrs/firmware'

const BASE = 'https://expresslrs.github.io/web-flasher/assets/firmware'

/** 2.4 GHz builds come in two regulatory flavors; the transmitter's decides. */
export type ElrsRegion = 'FCC' | 'LBT'

export interface ElrsVersion {
  version: string
  commit: string
}

export interface EspImage {
  name: string
  address: number
  data: Uint8Array
}

async function get(url: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error('Could not reach the ExpressLRS firmware site.')
  }
  if (res.status === 404) throw new Error('ExpressLRS does not publish that firmware file.')
  if (!res.ok) throw new Error(`The ExpressLRS firmware site answered ${res.status}.`)
  return res
}

let targetsCache: Promise<Record<string, unknown>> | null = null
function targets(): Promise<Record<string, unknown>> {
  targetsCache ??= get(`${BASE}/hardware/targets.json`)
    .then((r) => r.json() as Promise<Record<string, unknown>>)
    .catch((e: unknown) => {
      targetsCache = null
      throw e
    })
  return targetsCache
}

/** A receiver's entry in targets.json, from its "vendor.type.model" path. */
export async function elrsTarget(path: string): Promise<ElrsTargetConfig> {
  let node: unknown = await targets()
  for (const key of path.split('.')) {
    node =
      typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined
  }
  const t = node as Partial<ElrsTargetConfig> | undefined
  if (!t || typeof t.firmware !== 'string' || typeof t.layout_file !== 'string') {
    throw new Error(`ExpressLRS no longer lists the receiver ${path}.`)
  }
  return t as ElrsTargetConfig
}

/**
 * Released versions the receiver can run, newest first. Release candidates
 * are left out, as ExpressLRS Configurator does by default.
 */
export async function elrsVersions(target: ElrsTargetConfig): Promise<ElrsVersion[]> {
  const index = (await (await get(`${BASE}/index.json`)).json()) as {
    tags?: Record<string, string>
  }
  return Object.entries(index.tags ?? {})
    .filter(
      ([v]) =>
        !v.includes('-') && (!target.min_version || compareVersions(v, target.min_version) >= 0),
    )
    .map(([version, commit]) => ({ version, commit }))
    .sort((a, b) => compareVersions(b.version, a.version))
}

export interface ReceiverBuild {
  target: ElrsTargetConfig
  version: ElrsVersion
  region: ElrsRegion
  /** The user's binding phrase; empty for a receiver bound by button. Never stored. */
  phrase: string
  baud: number
}

/**
 * The four images for esptool, with this receiver's options written into
 * firmware.bin. Refuses images built for another chip.
 */
export async function receiverImages(
  build: ReceiverBuild,
  onProgress?: (done: number, total: number) => void,
): Promise<EspImage[]> {
  const { target, version, region } = build
  if (target.platform !== 'esp32-c3') {
    throw new Error(
      `This receiver is an ${target.platform}; only ESP32-C3 receivers are supported.`,
    )
  }
  const folder = `${BASE}/${version.commit}/${region}/${target.firmware}`
  let done = 0
  const total = ESP32C3_IMAGES.length + 1
  const fetchBytes = async (url: string) => {
    const data = new Uint8Array(await (await get(url)).arrayBuffer())
    onProgress?.(++done, total)
    return data
  }
  const layoutUrl = `${BASE}/hardware/RX/${encodeURIComponent(target.layout_file)}`
  const [layoutBytes, ...files] = await Promise.all([
    fetchBytes(layoutUrl),
    ...ESP32C3_IMAGES.map((f) => fetchBytes(`${folder}/${f.name}`)),
  ])
  const layout = JSON.parse(new TextDecoder().decode(layoutBytes)) as Record<string, unknown>

  const images: EspImage[] = ESP32C3_IMAGES.map((f, i) => ({ ...f, data: files[i]! }))
  for (const name of ['bootloader.bin', 'firmware.bin']) {
    const image = images.find((f) => f.name === name)!
    if (espImageChip(image.data) !== ESP32C3_CHIP_ID) {
      throw new Error(`The ExpressLRS ${name} is not built for an ESP32-C3.`)
    }
  }
  const firmware = images[images.length - 1]!
  firmware.data = configureFirmware(firmware.data, target, layout, {
    uid: build.phrase === '' ? null : bindingUid(build.phrase),
    wifiOnInterval: 60,
    uartBaud: build.baud,
    lockOnFirstConnection: true,
    flashDiscriminator: 1 + Math.floor(Math.random() * (2 ** 31 - 2)),
  })
  return images
}
