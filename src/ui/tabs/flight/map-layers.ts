// Base map choices. Satellite is the default because it shows the field.
//
// Esri World Imagery is used without a key; its terms require the
// attribution to stay visible, so it is kept with the layer definition.

export interface BaseLayer {
  id: 'satellite' | 'street'
  label: string
  url: string
  attribution: string
  /** Highest zoom the server actually has tiles for. */
  maxNativeZoom: number
  /** Leaflet keeps zooming past that by upscaling, rather than going blank. */
  maxZoom: number
  /** Tile server subdomains, if any. */
  subdomains?: string
}

export const BASE_LAYERS: readonly BaseLayer[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 19,
    maxZoom: 21,
  },
  {
    id: 'street',
    label: 'Street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxNativeZoom: 19,
    maxZoom: 21,
  },
]

export type BaseLayerId = BaseLayer['id']

const STORAGE_KEY = 'loftgcs.flight.baseLayer'

export function loadBaseLayer(): BaseLayerId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && BASE_LAYERS.some((l) => l.id === saved)) return saved as BaseLayerId
  } catch {
    // Private windows: fall through to the default.
  }
  return 'satellite'
}

export function saveBaseLayer(id: BaseLayerId) {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // The choice just won't persist.
  }
}

export function layerById(id: BaseLayerId): BaseLayer {
  return BASE_LAYERS.find((l) => l.id === id) ?? BASE_LAYERS[0]!
}
