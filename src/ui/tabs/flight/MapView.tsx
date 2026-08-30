import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useVehicleStore } from '../../../stores/vehicle-store'

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

export default function MapView({
  follow,
  onMapClick,
}: {
  follow: boolean
  onMapClick: (lat: number, lon: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const trailRef = useRef<L.Polyline | null>(null)
  const followRef = useRef(follow)
  followRef.current = follow
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    const map = L.map(el, { zoomControl: true }).setView([0, 0], 3)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    map.on('click', (e) => clickRef.current(e.latlng.lat, e.latlng.lng))
    trailRef.current = L.polyline([], { color: '#4684C5', weight: 3, opacity: 0.8 }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
      trailRef.current = null
    }
  }, [])

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

  return <div ref={containerRef} className="flight-map" />
}
