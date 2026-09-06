import { tileUrl, type TileCoord } from './tile-math'

// Map tiles kept on this machine, so a field with no signal still has a map.
//
// IndexedDB rather than the Cache API: both work in the browser and in
// Electron, but IndexedDB gives a usable size figure and a cheap "have I got
// this one" without materializing a Response. Tiles are Blobs keyed on
// layer/z/x/y.
//
// Nothing here throws at the caller. A cache that cannot open is a map that
// fetches from the network, which is exactly the behavior before this
// existed -- so every failure falls back to that rather than breaking a map
// someone is flying with.

const DB_NAME = 'loftgcs-tiles'
const DB_VERSION = 1
const STORE = 'tiles'

interface TileRecord {
  key: string
  blob: Blob
  bytes: number
  at: number
}

const key = (layerId: string, t: TileCoord) => `${layerId}/${t.z}/${t.x}/${t.y}`

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    // Private browsing, a corrupt database, storage denied: no cache, and
    // every read below then answers null and every write does nothing.
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const t = db.transaction(STORE, mode)
          const req = run(t.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          t.onerror = () => resolve(null)
          t.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export async function getTile(layerId: string, t: TileCoord): Promise<Blob | null> {
  const rec = (await tx<TileRecord | undefined>('readonly', (s) =>
    s.get(key(layerId, t)),
  )) as TileRecord | null
  return rec?.blob ?? null
}

/**
 * Whether a tile is stored, without reading it.
 *
 * `getKey` answers from the index and never materializes the blob, which
 * matters because the coverage overlay asks this of every tile on screen
 * at once -- a few hundred reads of 20 kB each would be a map that stutters
 * while it tells you the map is fine.
 */
export async function hasTile(layerId: string, t: TileCoord): Promise<boolean> {
  const found = await tx<IDBValidKey | undefined>('readonly', (store) =>
    store.getKey(key(layerId, t)),
  )
  return found !== null && found !== undefined
}

export async function putTile(layerId: string, t: TileCoord, blob: Blob): Promise<void> {
  await tx('readwrite', (s) =>
    s.put({ key: key(layerId, t), blob, bytes: blob.size, at: Date.now() } as TileRecord),
  )
}

export interface CacheStats {
  count: number
  bytes: number
}

/**
 * How much is stored.
 *
 * Walked with a cursor rather than summed from an index: the store is tens
 * of thousands of rows at most and this runs when a dialog opens, so the
 * simpler thing that needs no extra index wins.
 */
export async function cacheStats(): Promise<CacheStats> {
  const db = await openDb()
  if (!db) return { count: 0, bytes: 0 }
  return new Promise((resolve) => {
    let count = 0
    let bytes = 0
    try {
      const t = db.transaction(STORE, 'readonly')
      const req = t.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve({ count, bytes })
        const rec = cursor.value as TileRecord
        count++
        bytes += rec.bytes ?? 0
        cursor.continue()
      }
      req.onerror = () => resolve({ count, bytes })
    } catch {
      resolve({ count: 0, bytes: 0 })
    }
  })
}

export async function clearCache(): Promise<void> {
  await tx('readwrite', (s) => s.clear())
}

export interface PrefetchProgress {
  done: number
  total: number
  cached: number
  failed: number
}

/**
 * Fetch and store a list of tiles.
 *
 * Concurrency is deliberately modest. These are public tile servers used
 * keyless and courtesy is a condition of that; six at a time saturates a
 * field laptop's connection without looking like an attack, and a server
 * that starts refusing is worse than a download that takes another minute.
 * Tiles already stored are skipped, so re-running over an area only fetches
 * what is missing.
 */
export async function prefetchTiles(
  layerId: string,
  urlTemplate: string,
  tiles: readonly TileCoord[],
  onProgress: (p: PrefetchProgress) => void,
  signal?: AbortSignal,
  concurrency = 6,
): Promise<PrefetchProgress> {
  const progress: PrefetchProgress = { done: 0, total: tiles.length, cached: 0, failed: 0 }
  let next = 0

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return
      const i = next++
      if (i >= tiles.length) return
      const t = tiles[i]!
      try {
        if (await getTile(layerId, t)) {
          progress.cached++
        } else {
          const res = await fetch(tileUrl(urlTemplate, t), signal ? { signal } : {})
          if (res.ok) await putTile(layerId, t, await res.blob())
          else progress.failed++
        }
      } catch {
        // One tile failing is a hole in the map, not a failed download.
        if (!signal?.aborted) progress.failed++
      }
      progress.done++
      onProgress({ ...progress })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, worker))
  return progress
}
