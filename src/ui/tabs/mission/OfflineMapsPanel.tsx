import { useEffect, useRef, useState } from 'react'
import { LaButton, LaField, LaHint, LaSelect, LaSwitch } from '../../components/La'
import {
  cacheStats,
  clearCache,
  prefetchTiles,
  type PrefetchProgress,
} from '../../../services/tile-cache'
import {
  BYTES_PER_TILE,
  countTiles,
  formatBytes,
  tilesForBounds,
  type LatLonBounds,
} from '../../../services/tile-math'
import { layerById, loadBaseLayer } from '../flight/map-layers'
import {
  TERRAIN_LAYER_ID,
  TERRAIN_URL,
  terrainCoverage,
  terrainTilesForArea,
} from '../../../services/terrain'

// Downloading the map before leaving for the field.
//
// It lives in Mission mode because that is where a flight is prepared, and
// because the map here is already showing the area you are about to fly --
// so "this view" is a boundary you have already chosen rather than another
// one to draw.
//
// The estimate before the button matters more than the progress after it:
// tile counts quadruple per zoom level, and someone who asks for six levels
// over a whole valley on a phone hotspot should find that out before the
// download starts, not during.
//
// Elevation comes along with the imagery. It is a handful of tiles for a
// field -- one terrain tile is ten kilometers across -- and an area
// downloaded for a trip whose terrain profile then reads "no data" would be
// a download that did not do what it said.

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

  const refresh = () => void cacheStats().then(setStats)
  useEffect(refresh, [])

  // Terrain is a separate question from the map's own coverage: it is one
  // zoom level of very large tiles, so an area can have every scrap of
  // imagery and no elevation at all -- and the profile would then go quiet
  // at the field with nothing to explain it.
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
  }, [bounds, progress])

  const layer = layerById(loadBaseLayer())
  // Never past what the server actually has: asking for zoom 22 of imagery
  // that stops at 19 downloads three levels of nothing.
  const maxZoom = Math.min(layer.maxNativeZoom, Math.floor(zoom) + extra)
  const minZoom = Math.max(1, Math.min(Math.floor(zoom), maxZoom))
  const count = bounds ? countTiles(bounds, minZoom, maxZoom) : 0
  const running = progress !== null

  const start = async () => {
    if (!bounds) return
    const tiles = tilesForBounds(bounds, minZoom, maxZoom)
    const terrain = terrainTilesForArea(bounds)
    const total = tiles.length + terrain.length
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ done: 0, total, cached: 0, failed: 0 })
    const shift = (offset: number) => (p: PrefetchProgress) =>
      setProgress({ ...p, total, done: offset + p.done })
    await prefetchTiles(layer.id, layer.url, tiles, shift(0), controller.signal)
    if (!controller.signal.aborted) {
      await prefetchTiles(
        TERRAIN_LAYER_ID,
        TERRAIN_URL,
        terrain,
        shift(tiles.length),
        controller.signal,
      )
    }
    abortRef.current = null
    setProgress(null)
    refresh()
  }

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">Offline maps</h3>

      <LaField label="Area" htmlFor="offline-zoom">
        <LaSelect
          id="offline-zoom"
          value={String(extra)}
          disabled={running}
          onChange={(e) => setExtra(Number(e.target.value))}
        >
          {ZOOM_CHOICES.map((c) => (
            <option key={c.extra} value={c.extra}>
              {c.label}
            </option>
          ))}
        </LaSelect>
      </LaField>

      {running ? (
        <>
          <LaHint>
            {progress.done} of {progress.total} tiles
            {progress.failed > 0 && ` · ${progress.failed} unavailable`}
          </LaHint>
          <LaButton
            variant="ghost"
            size="block"
            onClick={() => {
              abortRef.current?.abort()
              abortRef.current = null
              setProgress(null)
              refresh()
            }}
          >
            Stop
          </LaButton>
        </>
      ) : (
        <>
          <LaButton
            variant="secondary"
            size="block"
            disabled={!bounds || count === 0}
            title={
              bounds
                ? `Zoom ${minZoom} to ${maxZoom} over the current view`
                : 'Move the map to the area you want'
            }
            onClick={() => void start()}
          >
            Download {count.toLocaleString()} tiles
          </LaButton>
          {/* The warning that earns this panel its space. */}
          <LaHint>
            About {formatBytes(count * BYTES_PER_TILE)}, plus elevation for the area. Tiles already
            stored are skipped.
          </LaHint>
        </>
      )}

      {/* A tile count cannot answer "will this work when I get there" -- a
          cache can hold five thousand tiles of the wrong valley. The map
          can, so the switch is next to the number rather than instead of
          it. */}
      <LaSwitch
        label="Show what is stored"
        checked={coverage}
        onChange={(e) => {
          onCoverage(e.target.checked)
          // The stored count is read once on mount, and panning the map
          // stores what it draws -- so by the time anyone asks to see the
          // coverage, the number beneath it is usually already stale and
          // would contradict the squares on screen.
          if (e.target.checked) refresh()
        }}
      />
      {coverage && <LaHint>Hatched squares are not stored at this zoom; clear ones are.</LaHint>}

      <LaHint>
        Stored: {stats.count.toLocaleString()} tiles, {formatBytes(stats.bytes)}. Panning the map
        online saves what it draws, so this only fills the gaps.
      </LaHint>

      {terrain && terrain.total > 0 && (
        <LaHint error={terrain.stored === 0}>
          {terrain.stored === terrain.total
            ? 'Elevation for this view is stored too.'
            : `Elevation: ${terrain.total - terrain.stored} of ${terrain.total} tiles missing — the profile needs these to draw the ground.`}
        </LaHint>
      )}
      <LaButton
        variant="ghost"
        size="block"
        disabled={running || stats.count === 0}
        onClick={() => void clearCache().then(refresh)}
      >
        Clear stored maps
      </LaButton>
    </section>
  )
}
