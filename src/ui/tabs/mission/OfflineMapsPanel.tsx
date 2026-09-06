import { useEffect, useRef, useState } from 'react'
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
  /**
   * What the last thing to happen was.
   *
   * A download that ends by putting the button back the way it was is
   * indistinguishable from one that never ran. The stored count does move,
   * but nobody watches a number they were not told to look at.
   */
  const [outcome, setOutcome] = useState<string | null>(null)

  // Everything numeric on this panel is a view of the cache, and the cache
  // is written by panning, the download, and the terrain loader, and emptied
  // by Clear -- none of which this component would otherwise hear about. One
  // subscription bumps a revision; the stats and the elevation line hang off
  // it, so what is on screen is what is in the store.
  const [cacheRev, setCacheRev] = useState(0)
  useEffect(() => subscribeCacheChanges(() => setCacheRev((n) => n + 1)), [])
  useEffect(() => {
    void cacheStats().then(setStats)
  }, [cacheRev])

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
  }, [bounds, cacheRev])

  const layer = layerById(loadBaseLayer())
  // Never past what the server actually has: asking for zoom 22 of imagery
  // that stops at 19 downloads three levels of nothing.
  const maxZoom = Math.min(layer.maxNativeZoom, Math.floor(zoom) + extra)
  const minZoom = Math.max(1, Math.min(Math.floor(zoom), maxZoom))
  const count = bounds ? countTiles(bounds, minZoom, maxZoom) : 0
  // What the download would actually fetch: past the area cap this is zero,
  // and promising "plus elevation" there would be a promise it cannot keep.
  const terrainForArea = bounds ? terrainTilesForArea(bounds).length : 0
  const running = progress !== null

  const start = async () => {
    if (!bounds) return
    const tiles = tilesForBounds(bounds, minZoom, maxZoom)
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
      {/* The zoom range clamps to what the imagery actually has, so near its
          deepest level the choices collapse into the same download -- which
          looked like a broken selector until the clamp said so out loud. */}
      {bounds && Math.floor(zoom) + extra > layer.maxNativeZoom && (
        <LaHint>Imagery ends at zoom {layer.maxNativeZoom}.</LaHint>
      )}

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
                ? `Zoom ${minZoom} to ${maxZoom} over this view; already-stored tiles are skipped`
                : 'Move the map to the area you want'
            }
            onClick={() => void start()}
          >
            Download {count.toLocaleString()} tiles
          </LaButton>
          {/* The size warning is the one line that earns permanent space --
              it is read before a decision. That the download skips stored
              tiles and which zooms it sweeps answer questions nobody has
              asked yet, so they wait on the button's title. */}
          <LaHint>
            About {formatBytes(count * BYTES_PER_TILE)}
            {terrainForArea > 0 ? ', elevation included' : ''}.
          </LaHint>
        </>
      )}

      {/* A tile count cannot answer "will this work when I get there" -- a
          cache can hold five thousand tiles of the wrong valley. The map
          can, so the switch is next to the number rather than instead of
          it. */}
      <LaSwitch
        label="Show stored tiles"
        checked={coverage}
        onChange={(e) => onCoverage(e.target.checked)}
      />
      {coverage && <LaHint>Red: missing. Green: stored.</LaHint>}

      <LaHint>
        Stored: {stats.count.toLocaleString()} tiles, {formatBytes(stats.bytes)}.
      </LaHint>

      {/* One elevation state gets a line, and it is the one that is a
          problem: a partial store, the hole in prep someone thinks is done.
          None stored is answered by "elevation included" on the download,
          fully stored by silence -- a status line per state read like a
          debug log. */}
      {bounds && terrain !== null && terrain.stored > 0 && terrain.stored < terrain.total && (
        <LaHint error>
          Elevation: {terrain.total - terrain.stored} of {terrain.total} tiles missing here.
        </LaHint>
      )}

      {outcome && <p className="app-col__note">{outcome}</p>}
      <LaButton
        variant="ghost"
        size="block"
        disabled={running || stats.count === 0}
        onClick={() =>
          void clearCache().then(() =>
            setOutcome('Cleared. Everything will come from the network again.'),
          )
        }
      >
        Clear stored maps
      </LaButton>
    </section>
  )
}

/**
 * What the download actually did, from what it reports -- never from what it
 * was asked for. The first version printed "Stored N map tiles" from the
 * request, which on a dead network was a success message over a cache that
 * had gained nothing.
 */
export function describeOutcome(map: PrefetchProgress, terrain: PrefetchProgress | null): string {
  const fresh = (p: PrefetchProgress) => p.done - p.failed - p.cached
  const stored = fresh(map) + (terrain ? fresh(terrain) : 0)
  const failed = map.failed + (terrain?.failed ?? 0)
  if (stored === 0 && failed === 0) return 'Everything in this view was already stored.'
  const parts: string[] = []
  if (stored > 0) parts.push(`Stored ${stored.toLocaleString()} ${stored === 1 ? 'tile' : 'tiles'}`)
  if (failed > 0)
    parts.push(`${failed.toLocaleString()} ${failed === 1 ? 'tile' : 'tiles'} could not be fetched`)
  return parts.join('; ') + '.'
}
