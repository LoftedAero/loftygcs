import L from 'leaflet'
import { hasTile, subscribeCacheChanges } from '../../../services/tile-cache'
import type { BaseLayer } from './map-layers'

// An overlay showing which map tiles are stored offline for the current view.
// A tile count cannot say whether the right area is cached; the map can.
//
// Built on Leaflet's GridLayer so its squares match the real tile boundaries
// at every zoom. Gaps are hatched red and stored squares get a green
// hairline, so the map stays readable where coverage is fine.
//
//  - It redraws when the cache changes: the cache is written by panning, the
//    download and the terrain loader, and emptied by Clear.
//
//  - It takes the base layer's maxNativeZoom. Past native zoom the offline
//    map upscales the stored native tile, so that tile decides coverage.

class CoverageLayer extends L.GridLayer {
  private layerId: string
  private unsubscribe: (() => void) | null = null

  constructor(layerId: string, options: L.GridLayerOptions) {
    super(options)
    this.layerId = layerId
  }

  onAdd(map: L.Map): this {
    super.onAdd(map)
    this.unsubscribe = subscribeCacheChanges(() => this.redraw())
    return this
  }

  onRemove(map: L.Map): this {
    this.unsubscribe?.()
    this.unsubscribe = null
    super.onRemove(map)
    return this
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'tile-coverage tile-coverage--pending'
    // Use classList, not className: by the time the cache answers, Leaflet
    // has added its own classes (including `leaflet-tile`, which positions
    // the square), and assigning className would wipe them.
    void hasTile(this.layerId, { z: coords.z, x: coords.x, y: coords.y }).then(
      (stored) => {
        cell.classList.remove('tile-coverage--pending')
        cell.classList.add(stored ? 'is-stored' : 'is-missing')
        done(undefined, cell)
      },
      () => {
        // No cache available: mark nothing rather than everything missing.
        cell.classList.remove('tile-coverage--pending')
        done(undefined, cell)
      },
    )
    return cell
  }
}

/** An overlay marking what this layer has stored, kept current as it changes. */
export function createCoverageLayer(layer: BaseLayer): L.GridLayer {
  return new CoverageLayer(layer.id, {
    pane: 'overlayPane',
    opacity: 1,
    maxNativeZoom: layer.maxNativeZoom,
    maxZoom: layer.maxZoom,
  })
}
