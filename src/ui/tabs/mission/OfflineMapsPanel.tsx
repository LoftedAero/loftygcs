import { useEffect, useMemo, useRef, useState } from 'react'
import { LaButton, LaField, LaHint, LaSelect, LaSwitch } from '../../components/La'
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
      <LaHint>
        {running
          ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} tiles` +
            (progress.failed > 0 ? ` · ${progress.failed} unavailable` : '')
          : bounds
            ? `About ${formatBytes(count * BYTES_PER_TILE)}` +
              (terrainForArea > 0 ? ', elevation included.' : '.')
            : BLANK}
      </LaHint>
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
