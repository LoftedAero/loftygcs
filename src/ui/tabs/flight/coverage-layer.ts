import L from 'leaflet'
import { hasTile } from '../../../services/tile-cache'

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
// The *gaps* are shaded, not the stored parts. What matters at the field is
// the hole, and hatching everything you already have would obscure the map
// underneath to say "fine".

class CoverageLayer extends L.GridLayer {
  private layerId: string

  constructor(layerId: string, options: L.GridLayerOptions) {
    super(options)
    this.layerId = layerId
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const cell = document.createElement('div')
    cell.className = 'tile-coverage tile-coverage--pending'
    void hasTile(this.layerId, { z: coords.z, x: coords.x, y: coords.y }).then(
      (stored) => {
        cell.className = 'tile-coverage ' + (stored ? 'is-stored' : 'is-missing')
        done(undefined, cell)
      },
      () => {
        // No cache to ask: say nothing rather than paint the whole view as
        // missing, which would be a lie about a map that works fine.
        cell.className = 'tile-coverage'
        done(undefined, cell)
      },
    )
    return cell
  }
}

/**
 * An overlay marking the tiles this layer has stored.
 *
 * `maxNativeZoom` is deliberately absent: coverage is about the tiles that
 * exist at *this* zoom, and Leaflet's upscaling would otherwise report a
 * z21 view as covered because z19 is.
 */
export function createCoverageLayer(layerId: string): L.GridLayer {
  return new CoverageLayer(layerId, { pane: 'overlayPane', opacity: 1 })
}
