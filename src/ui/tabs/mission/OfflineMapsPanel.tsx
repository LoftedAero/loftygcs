import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaField, LaHint, LaModal, LaSelect, LaSwitch } from '../../components/La'
import {
  cacheStats,
  clearCache,
  prefetchTiles,
  subscribeCacheChanges,
  type PrefetchProgress,
} from '../../../services/tile-cache'
import {
  BYTES_PER_TILE,
  formatBytes,
  offlineTiles,
  type LatLonBounds,
} from '../../../services/tile-math'
import { layerById, loadBaseLayer } from '../flight/map-layers'
import {
  copyToRadio,
  findRadioFolder,
  folderPicker,
  MAPS_FOLDERS,
  PICKER_ID,
  rememberCard,
  rememberedCard,
  type RadioCopy,
} from '../../../services/radio-maps'
import {
  TERRAIN_LAYER_ID,
  TERRAIN_URL,
  prefetchTerrainForView,
  terrainCoverage,
  terrainTilesForArea,
} from '../../../services/terrain'

// Downloads the current map view for offline use. It lives in Mission mode,
// where the map already shows the area to be flown.
//
// The size estimate is shown before the download, since tile counts
// quadruple per zoom level. Elevation is downloaded with the imagery; it is
// only a few tiles, since one terrain tile is about ten kilometers across.
//
// Copy to Lofty PFD writes the same tiles onto a radio's SD card for Lofty PFD's
// map (services/radio-maps.ts), fetching any not stored yet.

/** Holds an empty slot's line open, so the box never changes height. */
const BLANK = ' '

/**
 * Levels below the current view fetched as well, so zooming out over the field
 * offline still has a map: a screenful each, a few tiles per level.
 */
const ZOOM_OUT_LEVELS = 4

/** How far past the current view to fetch, so a small pan stays covered. */
const ZOOM_CHOICES = [
  { extra: 1, label: 'This view (+1 level)' },
  { extra: 2, label: 'This view (+2 levels)' },
  { extra: 3, label: 'This view (+3 levels)' },
]

export interface OfflineMapsPanelProps {
  /** The map's current bounds, or null before it has a view. */
  bounds: LatLonBounds | null
  zoom: number
  /** Whether the map is shading the squares it has not stored. */
  coverage: boolean
  onCoverage: (on: boolean) => void
}

export default function OfflineMapsPanel({
  bounds,
  zoom,
  coverage,
  onCoverage,
}: OfflineMapsPanelProps) {
  const [extra, setExtra] = useState(2)
  const [stats, setStats] = useState({ count: 0, bytes: 0 })
  const [progress, setProgress] = useState<PrefetchProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [terrain, setTerrain] = useState<{ stored: number; total: number } | null>(null)
  /** The result of the last action, so a finished download says so. */
  const [outcome, setOutcome] = useState<string | null>(null)

  // The cache is written by panning, the download and the terrain loader,
  // and emptied by Clear. One subscription bumps a revision that refreshes
  // the stats and the elevation line.
  const [cacheRev, setCacheRev] = useState(0)
  useEffect(() => subscribeCacheChanges(() => setCacheRev((n) => n + 1)), [])
  useEffect(() => {
    void cacheStats().then(setStats)
  }, [cacheRev])

  // The settled view prefetches its own terrain, so a field looked at from
  // home has a working profile offline. Deduped and capped in the service;
  // paused during a manual download, which fetches the same tiles.
  const downloading = progress !== null
  useEffect(() => {
    if (bounds && !downloading) void prefetchTerrainForView(bounds)
  }, [bounds, downloading])

  // Terrain coverage is tracked separately: an area can have all its
  // imagery and no elevation.
  useEffect(() => {
    if (!bounds) {
      setTerrain(null)
      return
    }
    let live = true
    void terrainCoverage(bounds).then((c) => {
      if (live) setTerrain(c)
    })
    return () => {
      live = false
    }
  }, [bounds, cacheRev])

  const layer = layerById(loadBaseLayer())
  // Never past the imagery's native zoom.
  const maxZoom = Math.min(layer.maxNativeZoom, Math.floor(zoom) + extra)
  const minZoom = Math.max(1, Math.min(Math.floor(zoom), maxZoom) - ZOOM_OUT_LEVELS)
  // Rebuilt when the view changes, not on each tile of a download's progress.
  const tiles = useMemo(
    () => (bounds ? offlineTiles(bounds, zoom, maxZoom, ZOOM_OUT_LEVELS) : []),
    [bounds, zoom, maxZoom],
  )
  const count = tiles.length
  // Zero past the terrain area cap.
  const terrainForArea = bounds ? terrainTilesForArea(bounds).length : 0
  const running = progress !== null
  // A folder picker is Chromium's: absent in Android's WebView.
  const picker = folderPicker()

  // Every press asks for the card first, showing where the tiles go; the
  // picker then opens on the card last copied to.
  const [card, setCard] = useState<FileSystemDirectoryHandle | null>(null)
  useEffect(() => {
    void rememberedCard().then(setCard)
  }, [])
  const [ask, setAsk] = useState<'card' | 'not-pfd' | 'maps' | null>(null)

  const copy = async () => {
    if (!bounds || !picker) return
    let picked: FileSystemDirectoryHandle
    try {
      picked = await picker({ mode: 'readwrite', id: PICKER_ID, ...(card && { startIn: card }) })
    } catch {
      // Canceled, or the write grant was refused, which reads the same.
      return
    }
    const folder = await findRadioFolder(picked)
    if (!folder) {
      // The dialog's paths end in maps, so that folder is the likely wrong
      // pick; it cannot be shown to be Lofty PFD's.
      setAsk(picked.name.toLowerCase() === 'maps' ? 'maps' : 'not-pfd')
      return
    }
    setAsk(null)
    setCard(picked)
    void rememberCard(picked)
    const controller = new AbortController()
    abortRef.current = controller
    setOutcome(null)
    setProgress({ done: 0, total: tiles.length * 2, cached: 0, failed: 0 })
    let result: RadioCopy | null = null
    try {
      // Satellite whatever this map shows: it is Lofty PFD's only layer.
      result = await copyToRadio(
        folder,
        layerById('satellite'),
        tiles,
        bounds,
        setProgress,
        controller.signal,
      )
    } catch {
      result = null
    }
    const stopped = controller.signal.aborted
    abortRef.current = null
    setProgress(null)
    setOutcome(stopped ? 'Stopped.' : describeCopy(result, folder.radio))
  }

  const start = async () => {
    if (!bounds) return
    // Stored maps are what a field without signal depends on, so ask that
    // they not be evicted, from the press that asked for them. Best effort.
    void navigator.storage?.persist?.().catch(() => false)
    const terrain = terrainTilesForArea(bounds)
    const total = tiles.length + terrain.length
    const controller = new AbortController()
    abortRef.current = controller
    setOutcome(null)
    setProgress({ done: 0, total, cached: 0, failed: 0 })
    const shift = (offset: number) => (p: PrefetchProgress) =>
      setProgress({ ...p, total, done: offset + p.done })
    const mapResult = await prefetchTiles(layer.id, layer.url, tiles, shift(0), controller.signal)
    let terrainResult: PrefetchProgress | null = null
    if (!controller.signal.aborted) {
      terrainResult = await prefetchTiles(
        TERRAIN_LAYER_ID,
        TERRAIN_URL,
        terrain,
        shift(tiles.length),
        controller.signal,
      )
    }
    const stopped = controller.signal.aborted
    abortRef.current = null
    setProgress(null)
    setOutcome(stopped ? 'Stopped.' : describeOutcome(mapResult, terrainResult))
  }

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Offline maps</h3>

      <LaField label="Resolution" htmlFor="offline-zoom">
        <LaSelect
          id="offline-zoom"
          value={String(extra)}
          disabled={running}
          onChange={(e) => {
            setExtra(Number(e.target.value))
            // The outcome no longer matches the settings.
            setOutcome(null)
          }}
        >
          {ZOOM_CHOICES.map((c) => (
            <option key={c.extra} value={c.extra}>
              {c.label}
            </option>
          ))}
        </LaSelect>
      </LaField>
      {/* Messages live in fixed slots, blank when empty, so the panel (pinned
          to the column's foot) never changes height.

          Slot one, under the button: progress while running, otherwise the
          size estimate. */}
      {running ? (
        <LaButton
          variant="ghost"
          size="block"
          onClick={() => {
            abortRef.current?.abort()
            abortRef.current = null
            setProgress(null)
          }}
        >
          Stop
        </LaButton>
      ) : (
        <LaButton
          variant="secondary"
          size="block"
          disabled={!bounds || count === 0}
          title={
            bounds
              ? `Zoom ${minZoom} to ${maxZoom} over this view`
              : 'Move the map to the area you want'
          }
          onClick={() => void start()}
        >
          Download {count.toLocaleString()} tiles
        </LaButton>
      )}
      {running ? (
        // A percentage, not a tile count: a copy counts each tile twice
        // (fetched, then written), and a download adds elevation tiles.
        <div className="offline-progress">
          <progress
            className="log-progress"
            value={progress.done}
            max={Math.max(1, progress.total)}
            aria-label="Offline maps progress"
          />
          <LaHint>
            {`${Math.floor((100 * progress.done) / Math.max(1, progress.total))}%` +
              (progress.failed > 0 ? ` · ${progress.failed.toLocaleString()} unavailable` : '')}
          </LaHint>
        </div>
      ) : (
        <LaHint>
          {bounds
            ? `About ${formatBytes(count * BYTES_PER_TILE)}` +
              (terrainForArea > 0 ? ', elevation included.' : '.')
            : BLANK}
        </LaHint>
      )}
      {picker && (
        <LaButton
          variant="secondary"
          size="block"
          disabled={!bounds || count === 0 || running}
          title="Write this view's satellite tiles to Lofty PFD on a radio's SD card"
          onClick={() => setAsk('card')}
        >
          Copy to Lofty PFD
        </LaButton>
      )}
      {ask && (
        <LaModal
          open
          title="Copy map tiles to Lofty PFD"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </LaButton>
              <LaButton variant="primary" onClick={() => void copy()}>
                Choose SD card
              </LaButton>
            </>
          }
        >
          {/* What to pick comes first, since a listed path reads as one to
              open; the paths show that Lofty PFD has to be there already. A
              pilot who opens WIDGETS or scripts anyway is still accepted
              (findRadioFolder). */}
          <p>Select the root directory of your radio's SD card or internal memory.</p>
          <p>Tiles will be stored at:</p>
          <dl className="pfd-folders">
            {MAPS_FOLDERS.map((f) => (
              <div key={f.radio} className="pfd-folders__row">
                <dt>{f.radio}</dt>
                <dd>{f.path}</dd>
              </div>
            ))}
          </dl>
          {/* Held open when empty, so a refused pick does not grow the dialog. */}
          <LaHint error>
            {ask === 'not-pfd'
              ? 'Lofty PFD is not installed there.'
              : ask === 'maps'
                ? 'Select the root directory, not maps.'
                : BLANK}
          </LaHint>
        </LaModal>
      )}
      {/* A tile count cannot say whether the right area is stored; the
          coverage overlay can. The count covers the whole store, every layer
          and area, as Clear below does. */}
      <div className="offline-stored">
        <LaSwitch
          label="Show stored tiles"
          checked={coverage}
          onChange={(e) => {
            onCoverage(e.target.checked)
            // The overlay shows the result; free the line for its legend.
            if (e.target.checked) setOutcome(null)
          }}
        />
        <span className="offline-stored__count">
          {stats.count.toLocaleString()} {stats.count === 1 ? 'tile' : 'tiles'} ·{' '}
          {formatBytes(stats.bytes)}
        </span>
      </div>
      {/* Slot two, in priority order: missing elevation, the last outcome,
          the native-zoom limit, and the overlay legend. */}
      <LaHint
        error={!!bounds && terrain !== null && terrain.stored > 0 && terrain.stored < terrain.total}
      >
        {bounds && terrain !== null && terrain.stored > 0 && terrain.stored < terrain.total
          ? `Elevation: ${terrain.total - terrain.stored} of ${terrain.total} tiles missing here.`
          : (outcome ??
            (bounds && Math.floor(zoom) + extra > layer.maxNativeZoom
              ? `Imagery ends at zoom ${layer.maxNativeZoom}.`
              : coverage
                ? 'Red: missing. Green: stored.'
                : BLANK))}
      </LaHint>
      <LaButton
        variant="ghost"
        size="block"
        disabled={running || stats.count === 0}
        onClick={() => void clearCache().then(() => setOutcome('Cleared.'))}
      >
        Clear stored maps
      </LaButton>
    </section>
  )
}

/** What a copy to the radio did, or that the card could not be written. */
export function describeCopy(result: RadioCopy | null, radio: string): string {
  if (!result) return 'The card could not be written.'
  const { written, missing } = result
  if (written === 0) return 'Nothing here could be copied.'
  const tiles = `${written.toLocaleString()} ${written === 1 ? 'tile' : 'tiles'}`
  if (missing === 0) return `Copied ${tiles} to the ${radio} radio.`
  return `Copied ${tiles} · ${missing.toLocaleString()} unavailable.`
}

/**
 * What the download did, from its returned progress rather than from the
 * request, so a dead network is not reported as success.
 */
export function describeOutcome(map: PrefetchProgress, terrain: PrefetchProgress | null): string {
  const fresh = (p: PrefetchProgress) => p.done - p.failed - p.cached
  const stored = fresh(map) + (terrain ? fresh(terrain) : 0)
  const failed = map.failed + (terrain?.failed ?? 0)
  // Short enough for a one-line slot.
  if (stored === 0 && failed === 0) return 'Everything here is already stored.'
  if (failed === 0) return `Stored ${stored.toLocaleString()} ${stored === 1 ? 'tile' : 'tiles'}.`
  if (stored === 0) return `${failed.toLocaleString()} tiles unavailable.`
  return `Stored ${stored.toLocaleString()} · ${failed.toLocaleString()} unavailable.`
}
