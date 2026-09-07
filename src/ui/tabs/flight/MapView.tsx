import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { relativeTo, useTrafficStore } from '../../../stores/traffic-store'
import { useUnits } from '../../../stores/preferences-store'
import { useFlightLayoutStore } from '../../../stores/flight-layout-store'
import { TrafficLayer } from './traffic-layer'
import { useMissionStore } from '../../../stores/mission-store'
import { createMissionOverlay, type MissionOverlay } from './mission-overlay'
import { createCachedTileLayer } from './cached-tile-layer'
import {
  BASE_LAYERS,
  layerById,
  loadBaseLayer,
  saveBaseLayer,
  type BaseLayerId,
} from './map-layers'

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
  const missionRef = useRef<MissionOverlay | null>(null)
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
    // Under the vehicle and its trail: the plan is context, not the subject.
    missionRef.current = createMissionOverlay(map)
    mapRef.current = map

    // Leaflet caches its container's size and only watches the window, so any
    // change to this pane -- closing the plot, dragging the divider, swapping
    // sides -- leaves it drawing at the old size: the container grows and the
    // map does not follow it. Watch the element itself instead.
    let frame = 0
    const observer = new ResizeObserver(() => {
      // A divider drag fires this continuously; one call per frame is plenty.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      trailRef.current = null
      missionRef.current = null
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
    // Reads the offline cache first and stores what it fetches, so panning
    // around the field before takeoff builds the cache for free.
    tileRef.current = createCachedTileLayer(spec).addTo(map)
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

  // Traffic. Driven by the reports alone, and this vehicle's position is
  // *read* at draw time rather than subscribed to: the marker positions do
  // not depend on where we are, only the relative-height labels do, and
  // subscribing to a store that ticks at telemetry rate would rebuild every
  // marker's icon ten times a second to move a number that changes once. The
  // engine sends a fresh picture every second for as long as anything is
  // being heard, so the labels are never more than that stale.
  const distanceUnit = useUnits().distance
  const showTraffic = useFlightLayoutStore((s) => s.showTraffic)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !showTraffic) return
    const layer = new TrafficLayer(map)
    const draw = () => {
      const v = useVehicleStore.getState()
      const own = v.latDeg === 0 && v.lonDeg === 0 ? null : v
      layer.update(relativeTo(useTrafficStore.getState().targets, own), distanceUnit)
    }
    draw()
    const unsub = useTrafficStore.subscribe(draw)
    return () => {
      unsub()
      layer.remove()
    }
    // Rebuilt when the switch or the unit changes: the tags carry a number
    // and a unit, and switching the preference must not leave feet on the
    // map and meters everywhere else.
  }, [distanceUnit, showTraffic])

  useEffect(() => {
    const draw = () => {
      missionRef.current?.update(
        useMissionStore.getState().plan.items,
        useVehicleStore.getState().missionSeq,
      )
    }
    draw()
    // Two sources, one drawing: the plan changes when it is edited or read
    // back from the vehicle, the current item changes as it is flown.
    const unsubPlan = useMissionStore.subscribe(draw)
    const unsubSeq = useVehicleStore.subscribe(draw)
    return () => {
      unsubPlan()
      unsubSeq()
    }
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
      {/* How many aircraft are being heard, whenever the layer is on.
          Without it, "no traffic in range" and "the layer is broken" are the
          same empty map -- which is exactly the question a receiver on a
          bench raises, and the traffic list used to answer before it was
          removed in favour of the markers. Zero is worth saying out loud;
          it is the answer most of the time, and an answer is not nothing. */}
      {showTraffic && <TrafficCount />}
    </div>
  )
}

/**
 * The traffic readout: a count, and where it came from.
 *
 * Deliberately says "no ADS-B receiver" rather than "0" until something has
 * been heard on this connection. Most vehicles have no receiver fitted, and
 * a permanent zero on those would read as a fault in something that was
 * never there -- where a vehicle that *has* heard an aircraft and now hears
 * none is genuinely reporting zero.
 */
function TrafficCount() {
  const count = useTrafficStore((s) => s.targets.length)
  const everSeen = useTrafficStore((s) => s.everSeen)
  return (
    <div className={`map-traffic-count${count > 0 ? ' is-active' : ''}`}>
      {everSeen
        ? `ADS-B: ${count} aircraft`
        : /* Not "0 aircraft": nothing has been heard at all, which on most
             vehicles means no receiver rather than an empty sky. */
          'ADS-B: nothing heard yet'}
    </div>
  )
}
