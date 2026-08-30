import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { BASE_LAYERS, layerById, loadBaseLayer, saveBaseLayer, type BaseLayerId } from './map-layers'

// Imperative Leaflet: the map, marker, and trail update outside React's
// render cycle -- a marker that re-rendered through the virtual DOM at
// telemetry rate would fight the map's own DOM. React owns the container
// div; Leaflet owns everything inside it.

const TRAIL_MAX_POINTS = 600

function vehicleIcon(headingDeg: number): L.DivIcon {
  // An orange track-up arrow; brand action color because the vehicle is
  // the one thing on this map you act on.
  return L.divIcon({
    className: 'vehicle-marker',
    html: `<svg width="34" height="34" viewBox="-17 -17 34 34" style="transform: rotate(${headingDeg}deg)">
      <path d="M0 -13 L9 11 L0 6 L-9 11 Z" fill="#F7941D" stroke="#2D2D2F" stroke-width="1.5"/>
    </svg>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

/** Where a guided "fly here" was last sent, so the click has a visible result. */
function targetIcon(): L.DivIcon {
  return L.divIcon({
    className: 'vehicle-marker',
    html: `<svg width="26" height="26" viewBox="-13 -13 26 26">
      <circle r="8" fill="none" stroke="#4684C5" stroke-width="2.5"/>
      <circle r="2" fill="#4684C5"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function homeIcon(): L.DivIcon {
  return L.divIcon({
    className: 'vehicle-marker',
    html: `<svg width="24" height="24" viewBox="-12 -12 24 24">
      <path d="M-8 2 L0 -7 L8 2 L8 8 L-8 8 Z" fill="none" stroke="#2FAE4E" stroke-width="2.5"/>
    </svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

export interface MapViewProps {
  follow: boolean
  onFollowChange: (v: boolean) => void
  /** Screen position and coordinates of a right-click on the map. */
  onContextMenu: (p: { lat: number; lon: number; x: number; y: number }) => void
  /** Marker for the last guided target, or null to clear it. */
  target?: { lat: number; lon: number } | null
  home?: { lat: number; lon: number } | null
}

export default function MapView({
  follow,
  onFollowChange,
  onContextMenu,
  target,
  home,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const trailRef = useRef<L.Polyline | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const targetRef = useRef<L.Marker | null>(null)
  const homeRef = useRef<L.Marker | null>(null)
  const followRef = useRef(follow)
  followRef.current = follow
  const menuRef = useRef(onContextMenu)
  menuRef.current = onContextMenu
  const [base, setBase] = useState<BaseLayerId>(loadBaseLayer)

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([0, 0], 3)
    // Right-click is the action gesture here, so the browser's own menu must
    // not appear on top of ours.
    map.getContainer().addEventListener('contextmenu', (e) => e.preventDefault())
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      menuRef.current({
        lat: e.latlng.lat,
        lon: e.latlng.lng,
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
      })
    })
    trailRef.current = L.polyline([], { color: '#4684C5', weight: 3, opacity: 0.85 }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      trailRef.current = null
      tileRef.current = null
      targetRef.current = null
      homeRef.current = null
    }
  }, [])

  // Base layer, swapped in place so the trail and markers stay put.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const spec = layerById(base)
    tileRef.current?.remove()
    tileRef.current = L.tileLayer(spec.url, {
      maxZoom: spec.maxZoom,
      maxNativeZoom: spec.maxNativeZoom,
      attribution: spec.attribution,
    }).addTo(map)
    // Behind the trail and markers, whichever order they were added in.
    tileRef.current.setZIndex(0)
    saveBaseLayer(base)
  }, [base])

  useEffect(() => {
    // Subscribe to store updates imperatively; unsubscribes with the tab.
    let firstFix = true
    const unsub = useVehicleStore.subscribe((s) => {
      const map = mapRef.current
      if (!map || s.latDeg === 0) return
      const pos: L.LatLngExpression = [s.latDeg, s.lonDeg]
      if (!markerRef.current) {
        markerRef.current = L.marker(pos, { icon: vehicleIcon(s.headingDeg) }).addTo(map)
      } else {
        markerRef.current.setLatLng(pos)
        markerRef.current.setIcon(vehicleIcon(s.headingDeg))
      }
      const trail = trailRef.current
      if (trail) {
        const points = trail.getLatLngs() as L.LatLng[]
        points.push(L.latLng(s.latDeg, s.lonDeg))
        if (points.length > TRAIL_MAX_POINTS) points.shift()
        trail.setLatLngs(points)
      }
      if (firstFix) {
        firstFix = false
        map.setView(pos, 17)
      } else if (followRef.current) {
        map.panTo(pos, { animate: false })
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!target) {
      targetRef.current?.remove()
      targetRef.current = null
      return
    }
    const pos: L.LatLngExpression = [target.lat, target.lon]
    if (targetRef.current) targetRef.current.setLatLng(pos)
    else targetRef.current = L.marker(pos, { icon: targetIcon() }).addTo(map)
  }, [target])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!home) {
      homeRef.current?.remove()
      homeRef.current = null
      return
    }
    const pos: L.LatLngExpression = [home.lat, home.lon]
    if (homeRef.current) homeRef.current.setLatLng(pos)
    else homeRef.current = L.marker(pos, { icon: homeIcon() }).addTo(map)
  }, [home])

  return (
    <div className="flight-map-wrap">
      <div ref={containerRef} className="flight-map" />
      {/* Map controls belong on the map, not in a strip somewhere else. */}
      <div className="map-controls">
        <div className="map-layer-switch la-row" role="group" aria-label="Base map">
          {BASE_LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`map-layer-switch__btn${base === l.id ? ' is-active' : ''}`}
              onClick={() => setBase(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`map-layer-switch__btn map-follow${follow ? ' is-active' : ''}`}
          aria-pressed={follow}
          onClick={() => onFollowChange(!follow)}
        >
          Follow
        </button>
      </div>
    </div>
  )
}
