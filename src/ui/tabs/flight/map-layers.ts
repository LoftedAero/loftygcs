// Base map choices. Satellite is the default because that is what you are
// actually looking at when you fly -- a street map tells you nothing about
// the field you are standing in.
//
// Esri World Imagery is used keyless. Its terms require the attribution
// below to stay visible, which is why the string travels with the layer
// definition rather than living in a component someone might tidy away.

export interface BaseLayer {
  id: 'satellite' | 'street'
  label: string
  url: string
  attribution: string
  /** Highest zoom the server actually has tiles for. */
  maxNativeZoom: number
  /** Leaflet keeps zooming past that by upscaling, rather than going blank. */
  maxZoom: number
  /** Esri's imagery service numbers tiles {z}/{y}/{x}, not {z}/{x}/{y}. */
  subdomains?: string
}

export const BASE_LAYERS: readonly BaseLayer[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
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
    // Not worth surfacing: the choice just won't persist.
  }
}

export function layerById(id: BaseLayerId): BaseLayer {
  return BASE_LAYERS.find((l) => l.id === id) ?? BASE_LAYERS[0]!
}
