import L from 'leaflet'
import { hasTile, subscribeCacheChanges } from '../../../services/tile-cache'
import type { BaseLayer } from './map-layers'

// What is, and is not, stored for the field you are looking at.
//
// The question "will this map work when I get there" has no honest answer
// from a number of tiles: a cache can hold five thousand tiles of the wrong
// valley. It has an obvious answer from the map itself, which is why this
// is an overlay rather than a readout.
//
// Built on Leaflet's own GridLayer so the squares it draws are exactly the
// squares the map draws -- a hand-rolled rectangle grid drifts from the
// real tile boundaries at every zoom, and a coverage picture that is a
// little bit wrong about where the edges are is worse than none.
//
// The *gaps* are hatched red; stored squares get a green hairline. What
// matters at the field is the hole, and hatching everything you already
// have would obscure the map underneath to say "fine".
//
// Two lessons, both learned from this overlay being wrong on screen:
//
//  - It redraws when the cache changes. Each square answers "is this
//    stored" at creation, but the cache is written by panning, by the
//    download, and by the terrain loader, and emptied by Clear -- so a
//    snapshot kept showing green outlines for tiles that were gone and red
//    hatch over tiles that had just arrived.
//
//  - It takes the base layer's maxNativeZoom. Without it, every square past
//    the imagery's native zoom hatched red however much was stored -- but
//    the offline map *works* there, upscaling the stored native tile the
//    same way the online one does. The overlay must report what the map
//    will do, and what the map will do is decided by the native tile.

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
    // classList surgery, never a className assignment: by the time the cache
    // answers, Leaflet has added its own classes to this element -- among
    // them `leaflet-tile`, which carries the position:absolute that puts the
    // square on its tile. Assigning className wiped them, and every resolved
    // cell fell out of the grid into a pile at the layer's origin: marks in
    // the wrong places, and none where they belonged.
    void hasTile(this.layerId, { z: coords.z, x: coords.x, y: coords.y }).then(
      (stored) => {
        cell.classList.remove('tile-coverage--pending')
        cell.classList.add(stored ? 'is-stored' : 'is-missing')
        done(undefined, cell)
      },
      () => {
        // No cache to ask: say nothing rather than paint the whole view as
        // missing, which would be a lie about a map that works fine.
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
