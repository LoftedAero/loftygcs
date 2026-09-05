import L from 'leaflet'
import { getTile, putTile } from '../../../services/tile-cache'
import type { BaseLayer } from './map-layers'

// A Leaflet tile layer that looks in the offline cache first.
//
// Leaflet's own TileLayer sets img.src and lets the browser fetch it, which
// leaves no place to consult a cache. Overriding createTile lets the tile
// come from IndexedDB when it is there and from the network otherwise --
// and a network tile is stored on the way past, so ordinary panning around
// the field before takeoff builds the cache for free.
//
// Everything degrades to the stock behaviour: no cache, or a cache that
// errors, just means every tile comes from the network as before.

class CachedTileLayer extends L.TileLayer {
  private layerId: string

  constructor(layerId: string, url: string, options: L.TileLayerOptions) {
    super(url, options)
    this.layerId = layerId
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const img = document.createElement('img')
    img.alt = ''
    // Leaflet needs these for its own fade-in and error handling.
    img.setAttribute('role', 'presentation')

    const coord = { z: coords.z, x: coords.x, y: coords.y }
    const url = this.getTileUrl(coords)
    let objectUrl: string | null = null

    const finish = (err?: Error) => done(err, img)
    // Revoking on load rather than on removal: the decoded image stays valid
    // once painted, and a blob URL per tile otherwise leaks for the session.
    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      finish()
    }
    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      finish(new Error('tile failed'))
    }

    void (async () => {
      const hit = await getTile(this.layerId, coord)
      if (hit) {
        objectUrl = URL.createObjectURL(hit)
        img.src = objectUrl
        return
      }
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        void putTile(this.layerId, coord, blob)
        objectUrl = URL.createObjectURL(blob)
        img.src = objectUrl
      } catch {
        // Offline with nothing cached for this square: let Leaflet show its
        // empty tile rather than a broken image.
        finish(new Error('tile unavailable'))
      }
    })()

    return img
  }
}

/** The base layer, reading through the offline cache. */
export function createCachedTileLayer(layer: BaseLayer): L.TileLayer {
  return new CachedTileLayer(layer.id, layer.url, {
    attribution: layer.attribution,
    maxNativeZoom: layer.maxNativeZoom,
    maxZoom: layer.maxZoom,
    ...(layer.subdomains ? { subdomains: layer.subdomains } : {}),
  })
}
