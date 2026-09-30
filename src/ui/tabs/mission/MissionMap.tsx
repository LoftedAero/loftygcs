import { useEffect, useRef, useState } from 'react'
import type { LatLonBounds } from '../../../services/tile-math'
import { createCachedTileLayer } from '../flight/cached-tile-layer'
import { createCoverageLayer } from '../flight/coverage-layer'
import { TERRAIN_ATTRIBUTION } from '../../../services/terrain'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useItemEditor } from './ItemEditor'
import { useMissionStore } from '../../../stores/mission-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, fromDistance, toDistance, type DistanceUnit } from '../../../units'
import { hasCoords, type PlanHome } from '../../../protocol/mission-plan'
import { commandSpec } from '../../../protocol/mission-commands'
import { DEFAULT_TOOL, HOME_TOOL } from './ItemPalette'
import { surveyGrid } from '../../../protocol/survey'
import {
  BASE_LAYERS,
  layerById,
  loadBaseLayer,
  saveBaseLayer,
  type BaseLayerId,
} from '../flight/map-layers'

// The mission map. Imperative Leaflet, like the flight map: routing drags
// through React's render cycle fights the map's own DOM.
//
// Markers are numbered by their sequence on the vehicle, matching the table
// and the numbers a DO_JUMP refers to.

export interface MissionMapProps {
  /** The command the palette has armed, or null to place the default. */
  tool: number | null
  onPlaced: () => void
  /**
   * A click landed on an empty plan. Missions almost always begin with a
   * takeoff, so the first click asks rather than placing a waypoint.
   */
  onFirstItem: (at: { x: number; y: number }) => void
  /**
   * The area currently on screen, e.g. for the offline-map download. Fired
   * when the view settles, not during a pan.
   */
  onView?: (view: { bounds: LatLonBounds; zoom: number }) => void
  /** Shade the squares this base layer has not stored for offline use. */
  coverage?: boolean
}

/** Numbered waypoint pin. Orange when selected, blue otherwise. */
function itemIcon(seq: number, selected: boolean, kind: 'nav' | 'other'): L.DivIcon {
  const fill = selected ? '#F7941D' : kind === 'nav' ? '#4684C5' : '#6B7280'
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="30" height="38" viewBox="-15 -30 30 38">
      <path d="M0 8 L-9 -12 A10 10 0 1 1 9 -12 Z" fill="${fill}" stroke="#2D2D2F" stroke-width="1.5"/>
      <text x="0" y="-14" text-anchor="middle" font-family="Roboto Mono, monospace"
            font-size="12" font-weight="700" fill="#fff">${seq}</text>
    </svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
  })
}

// Status colors for fence shapes. Literals because Leaflet takes colors as
// options rather than CSS; they are --la-good and --la-bad and must be
// changed with them.
const FENCE_IN = '#2FAE4E'
const FENCE_OUT = '#D63031'

/** A small draggable handle on a fence vertex or a circle's center. */
function vertexIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="14" height="14" viewBox="-7 -7 14 14">
      <rect x="-5" y="-5" width="10" height="10" fill="${color}" stroke="#fff" stroke-width="2"/>
    </svg>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

function returnIcon(opacity: number): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="26" height="26" viewBox="-13 -13 26 26" opacity="${opacity}">
      <circle r="11" fill="#2FAE4E" stroke="#fff" stroke-width="2"/>
      <path d="M-4 2 L0 -5 L4 2 Z" fill="#fff"/>
    </svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function rallyIcon(n: number, selected: boolean, opacity: number): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="26" height="30" viewBox="-13 -24 26 30" opacity="${opacity}">
      <path d="M0 6 L-8 -10 A9 9 0 1 1 8 -10 Z" fill="${selected ? '#F7941D' : '#2FAE4E'}"
            stroke="#2D2D2F" stroke-width="1.5"/>
      <text x="0" y="-8" text-anchor="middle" font-family="Roboto Mono, monospace"
            font-size="10" font-weight="700" fill="#fff">R${n}</text>
    </svg>`,
    iconSize: [26, 30],
    iconAnchor: [13, 30],
  })
}

function cornerIcon(n: number): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="20" height="20" viewBox="-10 -10 20 20">
      <circle r="8" fill="#4684C5" stroke="#fff" stroke-width="2"/>
      <text x="0" y="3.5" text-anchor="middle" font-family="Roboto Mono, monospace"
            font-size="9" font-weight="700" fill="#fff">${n}</text>
    </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

function homeIcon(selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'mission-marker',
    html: `<svg width="30" height="38" viewBox="-15 -30 30 38">
      <path d="M0 8 L-9 -12 A10 10 0 1 1 9 -12 Z" fill="${selected ? '#F7941D' : '#2FAE4E'}"
            stroke="#2D2D2F" stroke-width="1.5"/>
      <path d="M-5 -14 L0 -20 L5 -14 L5 -10 L-5 -10 Z" fill="none" stroke="#fff" stroke-width="1.8"/>
    </svg>`,
    iconSize: [30, 38],
    iconAnchor: [15, 38],
  })
}

export default function MissionMap({
  tool,
  onPlaced,
  onFirstItem,
  onView,
  coverage = false,
}: MissionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const coverRef = useRef<L.GridLayer | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const vehicleRef = useRef<L.Marker | null>(null)
  const [base, setBase] = useState<BaseLayerId>(loadBaseLayer)
  const [centered, setCentered] = useState(false)
  // Mirrors the state for the vehicle subscription, which is bound once.
  const centeredRef = useRef(false)
  centeredRef.current = centered

  // Read inside handlers so the click handler is not rebound when the armed
  // tool changes.
  const toolRef = useRef(tool)
  toolRef.current = tool
  const placedRef = useRef(onPlaced)
  placedRef.current = onPlaced
  const firstRef = useRef(onFirstItem)
  firstRef.current = onFirstItem

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return
    // Zoom buttons bottom-right: the palette owns the left edge.
    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([0, 0], 3)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)

    map.on('click', (e: L.LeafletMouseEvent) => {
      const store = useMissionStore.getState()
      const armed = toolRef.current
      const at = { x: Math.round(e.latlng.lat * 1e7), y: Math.round(e.latlng.lng * 1e7) }

      // While an area is being drawn, a click adds a corner.
      if (store.survey) {
        store.addSurveyVertex(at)
        return
      }

      // A click goes to whichever plan is being edited. Fence clicks need an
      // armed tool (there is no sensible default among five); a rally click
      // adds a point.
      if (store.editing === 'fence') {
        store.placeFencePoint(at)
        return
      }
      if (store.editing === 'rally') {
        store.addRally(at)
        return
      }

      // Home is placed, not appended: there is only ever one.
      if (armed === HOME_TOOL) {
        store.setHome({ ...at, z: store.plan.home?.z ?? 0 })
        placedRef.current()
        return
      }

      // Nothing armed adds a waypoint. The first click asks first.
      if (armed === null && store.plan.items.length === 0) {
        firstRef.current(at)
        return
      }
      store.addItem(armed ?? DEFAULT_TOOL, at)
      placedRef.current()
    })

    // Leaflet only watches the window, so pane resizes need a nudge.
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })
    observer.observe(el)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      map.remove()
      mapRef.current = null
      layerRef.current = null
      tileRef.current = null
      vehicleRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const spec = layerById(base)
    tileRef.current?.remove()
    // Reads the offline cache first and stores what it fetches.
    tileRef.current = createCachedTileLayer(spec).addTo(map)
    tileRef.current.setZIndex(0)
    saveBaseLayer(base)
    // Elevation data credit goes with the imagery credit.
    map.attributionControl.addAttribution(TERRAIN_ATTRIBUTION)
  }, [base])

  // The coverage overlay is rebuilt when the base layer changes, since each
  // layer has its own cached tiles.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    coverRef.current?.remove()
    coverRef.current = null
    if (!coverage) return
    const layer = createCoverageLayer(layerById(base)).addTo(map)
    layer.setZIndex(1)
    coverRef.current = layer
    return () => {
      layer.remove()
      coverRef.current = null
    }
  }, [coverage, base])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const report = () => {
      const c = map.getCenter()
      useMissionStore
        .getState()
        .setMapCenter({ x: Math.round(c.lat * 1e7), y: Math.round(c.lng * 1e7) })
    }
    report()
    map.on('moveend zoomend', report)
    return () => {
      map.off('moveend zoomend', report)
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !onView) return
    const report = () => {
      const b = map.getBounds()
      onView({
        bounds: {
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        },
        zoom: map.getZoom(),
      })
    }
    report()
    map.on('moveend zoomend', report)
    return () => {
      map.off('moveend zoomend', report)
    }
  }, [onView, centered])

  // Compact mode's item sheet covers the map's lower part, so an item it
  // opens on is panned into the part left showing. The sheet opens a render
  // after the tap, later still on its first mount, so this waits for it.
  const editorUid = useItemEditor((s) => s.uid)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !editorUid) return
    let frame = 0
    let tries = 30
    const pan = () => {
      const sheet = document.querySelector('.plan-sheet.is-open .plan-sheet__body')
      if (!sheet) {
        if (--tries > 0) frame = requestAnimationFrame(pan)
        return
      }
      const it = useMissionStore.getState().plan.items.find((i) => i.uid === editorUid)
      if (!it || !hasCoords(it)) return
      const box = map.getContainer().getBoundingClientRect()
      const size = map.getSize()
      const bottom = sheet.getBoundingClientRect().top - box.top
      const pt = map.latLngToContainerPoint([it.x / 1e7, it.y / 1e7])
      // Clear of the sheet's edge and the window's by a marker's height.
      const margin = 48
      const dy = pt.y > bottom - margin || pt.y < margin ? pt.y - bottom / 2 : 0
      const dx = pt.x < margin || pt.x > size.x - margin ? pt.x - size.x / 2 : 0
      if (dx || dy) map.panBy([dx, dy])
    }
    frame = requestAnimationFrame(pan)
    return () => cancelAnimationFrame(frame)
  }, [editorUid])

  // Redraw the whole plan on change. A mission is tens of markers, so
  // rebuilding is simpler than diffing.
  const plan = useMissionStore((s) => s.plan)
  const selected = useMissionStore((s) => s.selected)
  const survey = useMissionStore((s) => s.survey)
  const editing = useMissionStore((s) => s.editing)
  const fence = useMissionStore((s) => s.fence)
  const fenceDraft = useMissionStore((s) => s.fenceDraft)
  const rally = useMissionStore((s) => s.rally)
  const selectedShape = useMissionStore((s) => s.selectedShape)
  const units = useUnits()
  // Whether home's popup was open when the plan last changed. Every edit
  // rebuilds the layer and closes the popup, so it is reopened afterwards.
  const homePopupRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    const reopenHome = homePopupRef.current
    layer.clearLayers()

    const route: L.LatLngExpression[] = []
    if (plan.home) {
      const pos: L.LatLngExpression = [plan.home.x / 1e7, plan.home.y / 1e7]
      route.push(pos)
      // Home's altitude is edited from its marker, like every other point.
      const homeMarker = L.marker(pos, { icon: homeIcon(selected === 'home'), draggable: true })
        .on('click', () => useMissionStore.getState().select('home'))
        .on('dragend', (e) => {
          const p = (e.target as L.Marker).getLatLng()
          const store = useMissionStore.getState()
          store.setHome({
            x: Math.round(p.lat * 1e7),
            y: Math.round(p.lng * 1e7),
            z: store.plan.home?.z ?? 0,
          })
        })
        .on('popupopen', () => (homePopupRef.current = true))
        .on('popupclose', () => (homePopupRef.current = false))
      homeMarker.bindPopup(homePopup(plan.home, units.distance), { minWidth: 190 })
      homeMarker.addTo(layer)
      if (reopenHome) homeMarker.openPopup()
    }

    plan.items.forEach((it, i) => {
      if (!hasCoords(it)) return
      const pos: L.LatLngExpression = [it.x / 1e7, it.y / 1e7]
      const spec = commandSpec(it.command)
      const isNav = spec?.category === 'nav'
      // Only nav commands are legs of the route; an ROI is where the camera
      // looks.
      if (isNav) route.push(pos)
      L.marker(pos, {
        icon: itemIcon(i + 1, selected === it.uid, isNav ? 'nav' : 'other'),
        draggable: true,
      })
        .on('click', () => {
          useMissionStore.getState().select(it.uid)
          // Compact mode's editor; the desktop edits in the table.
          useItemEditor.getState().open(it.uid)
        })
        .on('dragend', (e) => {
          const p = (e.target as L.Marker).getLatLng()
          useMissionStore.getState().updateItem(it.uid, {
            x: Math.round(p.lat * 1e7),
            y: Math.round(p.lng * 1e7),
          })
        })
        .addTo(layer)
    })

    if (route.length > 1) {
      L.polyline(route, { color: '#F7941D', weight: 3, opacity: 0.9 }).addTo(layer)
    }

    // The fence and rally points are always drawn; plans not being edited
    // are faint.
    const dim = editing === 'fence' ? 1 : 0.45
    for (const shape of fence.shapes) {
      const color = shape.inclusive ? FENCE_IN : FENCE_OUT
      const style = {
        color,
        weight: selectedShape === shape.uid ? 4 : 2,
        opacity: dim,
        fillOpacity: 0.08 * dim,
        // Exclusion zones are dashed: translucent fills are hard to tell apart
        // on satellite imagery.
        dashArray: shape.inclusive ? undefined : '8 5',
      }
      if (shape.kind === 'polygon') {
        L.polygon(
          shape.points.map((q) => [q.x / 1e7, q.y / 1e7] as L.LatLngTuple),
          style,
        )
          .on('click', () => useMissionStore.getState().selectShape(shape.uid))
          .addTo(layer)
        if (editing === 'fence') {
          shape.points.forEach((q, i) => {
            L.marker([q.x / 1e7, q.y / 1e7], { icon: vertexIcon(color), draggable: true })
              .on('dragend', (e) => {
                const t = (e.target as L.Marker).getLatLng()
                useMissionStore.getState().moveShapeVertex(shape.uid, i, {
                  x: Math.round(t.lat * 1e7),
                  y: Math.round(t.lng * 1e7),
                })
              })
              .addTo(layer)
          })
        }
      } else {
        L.circle([shape.center.x / 1e7, shape.center.y / 1e7], {
          ...style,
          radius: shape.radiusM,
        })
          .on('click', () => useMissionStore.getState().selectShape(shape.uid))
          .addTo(layer)
        if (editing === 'fence') {
          L.marker([shape.center.x / 1e7, shape.center.y / 1e7], {
            icon: vertexIcon(color),
            draggable: true,
          })
            .on('dragend', (e) => {
              const t = (e.target as L.Marker).getLatLng()
              useMissionStore.getState().updateShape(shape.uid, {
                center: { x: Math.round(t.lat * 1e7), y: Math.round(t.lng * 1e7) },
              })
            })
            .addTo(layer)
        }
      }
    }

    // The polygon under construction, drawn open until Finish.
    if (fenceDraft.length > 0) {
      const line = fenceDraft.map((q) => [q.x / 1e7, q.y / 1e7] as L.LatLngTuple)
      if (line.length > 1)
        L.polyline(line, { color: FENCE_IN, weight: 2, dashArray: '4 4' }).addTo(layer)
      fenceDraft.forEach((q) => {
        L.marker([q.x / 1e7, q.y / 1e7], { icon: vertexIcon(FENCE_IN) }).addTo(layer)
      })
    }

    if (fence.returnPoint) {
      L.marker([fence.returnPoint.x / 1e7, fence.returnPoint.y / 1e7], {
        icon: returnIcon(dim),
        draggable: editing === 'fence',
      })
        .on('dragend', (e) => {
          const t = (e.target as L.Marker).getLatLng()
          useMissionStore
            .getState()
            .setFenceReturn({ x: Math.round(t.lat * 1e7), y: Math.round(t.lng * 1e7) })
        })
        .addTo(layer)
    }

    const rallyDim = editing === 'rally' ? 1 : 0.5
    rally.forEach((q, i) => {
      L.marker([q.x / 1e7, q.y / 1e7], {
        icon: rallyIcon(i + 1, selectedShape === q.uid, rallyDim),
        draggable: editing === 'rally',
      })
        .on('click', () => useMissionStore.getState().selectShape(q.uid))
        .on('dragend', (e) => {
          const t = (e.target as L.Marker).getLatLng()
          useMissionStore
            .getState()
            .updateRally(q.uid, { x: Math.round(t.lat * 1e7), y: Math.round(t.lng * 1e7) })
        })
        .addTo(layer)
    })

    // The survey area and a preview of its passes, in blue because they are
    // not part of the mission until added.
    if (survey) {
      const ring = survey.polygon.map((p) => [p.x / 1e7, p.y / 1e7] as L.LatLngTuple)
      if (ring.length >= 3) {
        L.polygon(ring, {
          color: '#4684C5',
          weight: 2,
          fillOpacity: 0.12,
          dashArray: '6 4',
        }).addTo(layer)
        const preview = surveyGrid(survey.polygon, survey.options)
        for (let i = 0; i + 1 < preview.points.length; i += 2) {
          L.polyline(
            [
              [preview.points[i]!.x / 1e7, preview.points[i]!.y / 1e7],
              [preview.points[i + 1]!.x / 1e7, preview.points[i + 1]!.y / 1e7],
            ],
            { color: '#4684C5', weight: 2, opacity: 0.85 },
          ).addTo(layer)
        }
      } else if (ring.length === 2) {
        L.polyline(ring, { color: '#4684C5', weight: 2, dashArray: '6 4' }).addTo(layer)
      }
      survey.polygon.forEach((p, i) => {
        L.marker([p.x / 1e7, p.y / 1e7], { icon: cornerIcon(i + 1), draggable: true })
          .on('dragend', (e) => {
            const q = (e.target as L.Marker).getLatLng()
            useMissionStore
              .getState()
              .moveSurveyVertex(i, { x: Math.round(q.lat * 1e7), y: Math.round(q.lng * 1e7) })
          })
          .on('contextmenu', () => useMissionStore.getState().removeSurveyVertex(i))
          .addTo(layer)
      })
    }

    // Frame the mission once, when there first is one to frame.
    if (!centered && route.length > 0) {
      centeredRef.current = true
      setCentered(true)
      if (route.length === 1) map.setView(route[0]!, 17)
      else {
        // Extra room at the top, where the palette floats over the map.
        map.fitBounds(L.latLngBounds(route as L.LatLngTuple[]), {
          paddingTopLeft: [20, 76],
          paddingBottomRight: [20, 24],
        })
      }
    }
  }, [plan, selected, survey, editing, fence, fenceDraft, rally, selectedShape, centered, units])

  // The vehicle, when there is one, so the plan can be seen against it.
  useEffect(() => {
    return useVehicleStore.subscribe((v) => {
      const map = mapRef.current
      if (!map || (v.latDeg === 0 && v.lonDeg === 0)) return
      const pos: L.LatLngExpression = [v.latDeg, v.lonDeg]
      // With an empty plan, center on the vehicle's first fix. A plan takes
      // precedence: the redraw effect fits to it and sets the same flag.
      if (!centeredRef.current) {
        centeredRef.current = true
        setCentered(true)
        map.setView(pos, 17)
      }
      const icon = L.divIcon({
        className: 'vehicle-marker',
        html: `<svg width="28" height="28" viewBox="-14 -14 28 28" style="transform: rotate(${v.headingDeg}deg)">
          <path d="M0 -11 L7 9 L0 5 L-7 9 Z" fill="#F7941D" stroke="#2D2D2F" stroke-width="1.5"/>
        </svg>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      if (!vehicleRef.current) vehicleRef.current = L.marker(pos, { icon }).addTo(map)
      else {
        vehicleRef.current.setLatLng(pos)
        vehicleRef.current.setIcon(icon)
      }
    })
  }, [])

  return (
    <div className={`mission-map-wrap${tool !== null ? ' is-placing' : ''}`}>
      <div ref={containerRef} className="mission-map" />
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
      </div>
    </div>
  )
}

/**
 * The home marker's popup: position and altitude.
 *
 * Built as plain DOM, since the layer is imperative Leaflet. The altitude
 * commits on change, not per keystroke, because each commit rebuilds the
 * layer.
 */
function homePopup(home: PlanHome, unit: DistanceUnit): HTMLElement {
  const el = document.createElement('div')
  el.className = 'map-popup'

  const coords = document.createElement('div')
  coords.className = 'app-col__mono'
  coords.textContent = `${(home.x / 1e7).toFixed(7)}, ${(home.y / 1e7).toFixed(7)}`
  el.append(coords)

  const row = document.createElement('label')
  row.className = 'map-popup__row'
  const name = document.createElement('span')
  name.className = 'la-field__unit'
  name.textContent = 'Altitude'
  const input = document.createElement('input')
  input.type = 'number'
  input.className = 'la-input la-input--num map-popup__num'
  input.value = String(Math.round(toDistance(home.z, unit)))
  const suffix = document.createElement('span')
  suffix.className = 'la-field__unit'
  suffix.textContent = `${distanceLabel(unit)} AMSL`
  row.append(name, input, suffix)
  el.append(row)

  const hint = document.createElement('p')
  hint.className = 'la-hint'
  hint.textContent = 'Relative altitudes are measured from here.'
  el.append(hint)

  // The only way to remove home, which is otherwise uploaded as mission
  // item 0.
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'la-btn la-btn--ghost la-btn--block'
  remove.textContent = 'Remove home'
  remove.title = 'Plan without a home position'
  remove.addEventListener('click', () => useMissionStore.getState().setHome(null))
  el.append(remove)

  input.addEventListener('change', () => {
    const value = Number(input.value)
    if (!Number.isFinite(value)) return
    const store = useMissionStore.getState()
    const current = store.plan.home
    if (!current) return
    store.setHome({ ...current, z: fromDistance(value, unit) })
  })

  // Stop propagation, or arrow keys pan the map and a swipe starts a drag.
  L.DomEvent.disableClickPropagation(el)
  L.DomEvent.disableScrollPropagation(el)
  L.DomEvent.on(input, 'keydown', L.DomEvent.stopPropagation)
  return el
}
