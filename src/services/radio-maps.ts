import { getTile, prefetchTiles, type PrefetchProgress } from './tile-cache'
import { wrapLon, type LatLonBounds, type TileCoord } from './tile-math'

// Offline map tiles copied onto a radio's SD card, for Lofty PFD's map.
//
// Lofty PFD reads them from a `maps` folder beside its own scripts:
// `maps/index.txt` names each layer and `maps/<layer>/<z>/<x>/<y>.jpg` holds
// its tiles. Lofty PFD shows satellite imagery only, so the panel copies that
// layer; the index keeps a line per layer all the same. Radios decode
// baseline JPEG and nothing else reliably, so every tile is re-encoded. The
// radio cannot list a folder, which is why the index exists.
//
// The card is reached with the File System Access API, so this needs
// Chromium: the desktop app or Chrome. Android's WebView has no folder
// picker, so the panel hides the button there.

/** Where Lofty PFD lives on a card, by radio. */
export const RADIO_FOLDERS = [
  { radio: 'EdgeTX', path: ['WIDGETS', 'LoftyPFD'] },
  { radio: 'Ethos', path: ['scripts', 'loftypfd'] },
] as const

export interface RadioFolder {
  radio: string
  dir: FileSystemDirectoryHandle
}

/** Where each radio keeps the copied tiles, as the pilot would look for them. */
export const MAPS_FOLDERS = RADIO_FOLDERS.map((f) => ({
  radio: f.radio,
  path: [...f.path, 'maps'].join('/'),
}))

interface PickerOptions {
  mode: 'readwrite'
  /** Chromium reopens the picker where the last one with this id was left. */
  id: string
  startIn?: FileSystemDirectoryHandle
}
type Picker = (opts: PickerOptions) => Promise<FileSystemDirectoryHandle>

/** The folder picker, where this build has one. */
export function folderPicker(): Picker | null {
  const w = window as unknown as { showDirectoryPicker?: Picker }
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(window) : null
}

export const PICKER_ID = 'lofty-pfd'

// The card last copied to, kept so the next picker opens on it. A handle is
// not JSON, so it lives in IndexedDB rather than the preferences document,
// and in its own database so clearing stored maps keeps it. Never throws:
// without storage the picker opens where it would anyway.
const CARD_DB = 'loftgcs-radio'
const CARD_STORE = 'card'

function cardStore(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(CARD_DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(CARD_STORE)
      req.onsuccess = () =>
        resolve(req.result.transaction(CARD_STORE, mode).objectStore(CARD_STORE))
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function rememberedCard(): Promise<FileSystemDirectoryHandle | null> {
  const store = await cardStore('readonly')
  if (!store) return null
  return new Promise((resolve) => {
    const req = store.get('card')
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function rememberCard(card: FileSystemDirectoryHandle): Promise<void> {
  const store = await cardStore('readwrite')
  try {
    store?.put(card, 'card')
  } catch {
    // A handle this build cannot store: the picker opens where it would anyway.
  }
}

async function child(dir: FileSystemDirectoryHandle, name: string, create = false) {
  try {
    return await dir.getDirectoryHandle(name, { create })
  } catch {
    return null
  }
}

/**
 * Lofty PFD's folder under what was picked: the card itself, the radio's
 * `WIDGETS` or `scripts`, or the widget's folder picked directly (it holds
 * `core`), since the dialog shows that path and a pilot may follow it. Null
 * when Lofty PFD is not there, since maps without the widget would be lost on
 * the card. A `maps` folder is not accepted: nothing above a picked folder can
 * be read, so nothing would show it is Lofty PFD's.
 */
export async function findRadioFolder(
  picked: FileSystemDirectoryHandle,
): Promise<RadioFolder | null> {
  for (const f of RADIO_FOLDERS) {
    // FAT is case-insensitive, so a folder name compares the same way.
    const inTop = picked.name.toLowerCase() === f.path[0].toLowerCase()
    let dir: FileSystemDirectoryHandle | null = picked
    for (const name of inTop ? f.path.slice(1) : f.path) {
      dir = dir && (await child(dir, name))
    }
    if (dir) return { radio: f.radio, dir }
  }
  if (await child(picked, 'core')) {
    const radio = picked.name === 'loftypfd' ? 'Ethos' : 'EdgeTX'
    return { radio, dir: picked }
  }
  return null
}

/** One layer as the index lists it. */
export interface IndexEntry {
  id: string
  label: string
  minZoom: number
  maxZoom: number
  /** Where the radio's map looks before the aircraft has a position. */
  center: { lat: number; lon: number } | null
  credit: string
}

const INDEX_HEAD =
  '# Lofty PFD maps, written by Lofty GCS. One layer a line: id|label|min zoom|max zoom|center lat|center lon|credit'

/**
 * A layer's credit as plain text: the radio draws no HTML. The "|" is the
 * index's separator.
 */
export function plainCredit(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/\|/g, '/')
    .trim()
}

export function parseIndex(text: string): IndexEntry[] {
  const out: IndexEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^([\w-]+)\|([^|]*)\|(\d+)\|(\d+)\|([-\d.]*)\|([-\d.]*)\|(.*)$/.exec(line)
    if (!m) continue
    const lat = m[5] ? Number(m[5]) : NaN
    const lon = m[6] ? Number(m[6]) : NaN
    out.push({
      id: m[1]!,
      label: m[2]!,
      minZoom: Number(m[3]),
      maxZoom: Number(m[4]),
      center: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null,
      credit: m[7]!,
    })
  }
  return out
}

export function formatIndex(entries: readonly IndexEntry[]): string {
  const lines = entries.map((e) =>
    [
      e.id,
      e.label,
      e.minZoom,
      e.maxZoom,
      e.center ? e.center.lat.toFixed(6) : '',
      e.center ? e.center.lon.toFixed(6) : '',
      e.credit,
    ].join('|'),
  )
  return [INDEX_HEAD, ...lines].join('\n') + '\n'
}

/**
 * The index after a copy: the copied layer added or widened to cover both
 * its old zoom levels and the new ones, centered on the new area; the
 * others kept as they were.
 */
export function mergeIndex(existing: string, entry: IndexEntry): string {
  const entries = parseIndex(existing)
  const at = entries.findIndex((e) => e.id === entry.id)
  if (at < 0) {
    entries.push(entry)
  } else {
    const old = entries[at]!
    entries[at] = {
      ...entry,
      minZoom: Math.min(old.minZoom, entry.minZoom),
      maxZoom: Math.max(old.maxZoom, entry.maxZoom),
    }
  }
  return formatIndex(entries)
}

/** A tile's file, as the radio asks for it. */
export function tilePath(layerId: string, t: TileCoord): string[] {
  return ['maps', layerId, String(t.z), String(t.x), `${t.y}.jpg`]
}

async function writeFile(root: FileSystemDirectoryHandle, path: string[], data: Blob | string) {
  let dir = root
  for (const name of path.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(name, { create: true })
  }
  const file = await dir.getFileHandle(path[path.length - 1]!, { create: true })
  const out = await file.createWritable()
  await out.write(data)
  await out.close()
}

async function readText(root: FileSystemDirectoryHandle, path: string[]): Promise<string> {
  try {
    let dir = root
    for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name)
    const file = await dir.getFileHandle(path[path.length - 1]!)
    return await (await file.getFile()).text()
  } catch {
    return ''
  }
}

/**
 * A tile as baseline JPEG, which both radios decode. Chromium's encoder
 * writes baseline; quality 0.8 keeps a satellite tile near its original size.
 */
async function toJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2D canvas')
    // A transparent PNG pixel would otherwise turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  } finally {
    bitmap.close()
  }
}

export interface RadioCopy {
  /** Tiles written to the card. */
  written: number
  /** Tiles neither stored nor fetchable, left as holes in the radio's map. */
  missing: number
}

export interface CopyLayer {
  id: string
  label: string
  url: string
  attribution: string
}

/**
 * Fetches whatever of `tiles` is not stored yet, then writes them all to the
 * radio with the index updated. Progress counts the fetch and the copy as one
 * run of twice the tiles.
 *
 * Rejects when the card cannot be written (full, read-only, removed): every
 * later tile would fail the same way. A stopped copy still indexes what it
 * wrote, or a first copy would leave tiles the radio never looks for.
 */
export async function copyToRadio(
  folder: RadioFolder,
  layer: CopyLayer,
  tiles: readonly TileCoord[],
  bounds: LatLonBounds,
  onProgress: (p: PrefetchProgress) => void,
  signal?: AbortSignal,
): Promise<RadioCopy> {
  const total = tiles.length * 2
  await prefetchTiles(layer.id, layer.url, tiles, (p) => onProgress({ ...p, total }), signal)
  const result: RadioCopy = { written: 0, missing: 0 }
  // Over what was written, in a loop: Math.min(...) overflows the stack on
  // tens of thousands of tiles.
  let minZoom = Infinity
  let maxZoom = -Infinity
  let done = tiles.length
  for (const t of tiles) {
    if (signal?.aborted) break
    const blob = await getTile(layer.id, t)
    const jpeg = blob && (await toJpeg(blob).catch(() => null))
    if (jpeg) {
      await writeFile(folder.dir, tilePath(layer.id, t), jpeg)
      result.written++
      minZoom = Math.min(minZoom, t.z)
      maxZoom = Math.max(maxZoom, t.z)
    } else {
      result.missing++
    }
    done++
    onProgress({ done, total, cached: 0, failed: result.missing })
  }
  if (result.written > 0) {
    const index = mergeIndex(await readText(folder.dir, ['maps', 'index.txt']), {
      id: layer.id,
      label: layer.label,
      minZoom,
      maxZoom,
      center: {
        lat: (bounds.north + bounds.south) / 2,
        lon: wrapLon((bounds.east + bounds.west) / 2),
      },
      credit: plainCredit(layer.attribution),
    })
    await writeFile(folder.dir, ['maps', 'index.txt'], index)
  }
  return result
}
