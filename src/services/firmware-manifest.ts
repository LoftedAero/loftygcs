// Official-firmware index from firmware.ardupilot.org/manifest.json.gz.
// That host sends no CORS headers, so this only works where the Electron
// main-process fetch bridge exists; the browser build offers file loading
// and a link-out instead.

export interface FirmwareOption {
  vehicle: string
  channel: 'stable' | 'beta' | 'dev'
  platform: string
  version: string
  url: string
  boardId: number
}

interface ManifestEntry {
  vehicletype?: string
  platform?: string
  url?: string
  format?: string
  board_id?: number
  'mav-firmware-version'?: string
  'mav-firmware-version-type'?: string
}

const MANIFEST_URL = 'https://firmware.ardupilot.org/manifest.json.gz'

const CHANNEL_MAP: Record<string, FirmwareOption['channel']> = {
  OFFICIAL: 'stable',
  BETA: 'beta',
  DEV: 'dev',
}

let cache: FirmwareOption[] | null = null

export function manifestAvailable(): boolean {
  return typeof window !== 'undefined' && window.loftgcs !== undefined
}

export async function loadFirmwareManifest(): Promise<FirmwareOption[]> {
  if (cache) return cache
  const bridge = window.loftgcs
  if (!bridge) throw new Error('firmware browsing needs the desktop app (CORS)')
  const gz = await bridge.app.fetchFirmware(MANIFEST_URL)
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  const json = (await new Response(stream).json()) as { firmware?: ManifestEntry[] }

  const options: FirmwareOption[] = []
  for (const e of json.firmware ?? []) {
    // Only current-channel .apj builds: the flashable format, deduplicated
    // from the ~90k historical entries.
    const channel = CHANNEL_MAP[e['mav-firmware-version-type'] ?? '']
    if (e.format !== 'apj' || !channel) continue
    if (!e.vehicletype || !e.platform || !e.url || typeof e.board_id !== 'number') continue
    options.push({
      vehicle: e.vehicletype,
      channel,
      platform: e.platform,
      version: e['mav-firmware-version'] ?? '',
      url: e.url,
      boardId: e.board_id,
    })
  }
  cache = options
  return options
}

/** The matching bootloader-included image for DFU recovery, by convention. */
export function withBootloaderUrl(apjUrl: string): string {
  return apjUrl.replace(/\.apj$/, '_with_bl.hex')
}
