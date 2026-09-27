import L from 'leaflet'
import { getTile, putTile } from '../../../services/tile-cache'
import type { BaseLayer } from './map-layers'

// A Leaflet tile layer that looks in the offline cache first.
//
// Leaflet's TileLayer sets img.src and lets the browser fetch, leaving no
// place to consult a cache. Overriding createTile reads from IndexedDB first
// and stores network tiles as they pass, so panning around the field builds
// the cache.
//
// Without a working cache, every tile simply comes from the network.

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
    // Revoke on load rather than on removal: the decoded image stays valid,
    // and otherwise each tile's blob URL leaks for the session.
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
        // Offline and not cached: Leaflet shows its empty tile.
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
