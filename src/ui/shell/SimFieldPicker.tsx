import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LaButton, LaField, LaHint, LaInput, LaModal } from '../components/La'
import { useUiStore } from '../../stores/ui-store'
import { useHomeText, useSimStore } from '../../stores/sim-store'
import { defaultHome, formatHome, parseHome, type SimHome } from '../../sim-home'
import { createCachedTileLayer } from '../tabs/flight/cached-tile-layer'
import { BASE_LAYERS, layerById, loadBaseLayer, saveBaseLayer } from '../tabs/flight/map-layers'
import type { BaseLayerId } from '../tabs/flight/map-layers'
import { loadTerrain } from '../../services/terrain'
import { groundLevel, sampleElevation } from '../../services/terrain-math'

// Pick where the simulated vehicle boots by pointing at it on a map. A typed
// coordinate with a transposed digit still parses and boots the vehicle far
// away; a point on imagery can be checked by eye.
//
// It also sets the heading, by turning an arrow to match the runway (with
// RealFlight, `--home`'s yaw orients the scenery), and the AMSL altitude,
// looked up from the Terrarium tiles and left editable.
//
// Rendered from App rather than inside the tray, because the tray closes on
// any outside click. Closing the picker reopens the tray.

/** Where a picker with nothing to go on starts. */
const FALLBACK_ZOOM = 17

export default function SimFieldPicker() {
  const open = useUiStore((s) => s.fieldPickerOpen)
  const setOpen = useUiStore((s) => s.setFieldPickerOpen)
  const setSimTrayOpen = useUiStore((s) => s.setSimTrayOpen)
  const homeText = useHomeText()
  const setHomeText = useSimStore((s) => s.setHomeText)
  // Decides the default home, so the picker opens where an unset home boots.
  const physics = useSimStore((s) => s.physics)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const baseRef = useRef<L.TileLayer | null>(null)

  const [layerId, setLayerId] = useState<BaseLayerId>(loadBaseLayer)
  const [home, setHome] = useState<SimHome>(() => defaultHome(physics.kind))
  /** True while an elevation lookup is in flight. */
  const [lookingUp, setLookingUp] = useState(false)

  // Seed from the tray's current value each time it opens.
  useEffect(() => {
    if (!open) return
    const parsed = parseHome(homeText)
    setHome('home' in parsed ? parsed.home : defaultHome(physics.kind))
    // Keyed on `open` alone so re-seeding does not fight the marker being
    // dragged.
  }, [open])

  // Built on open and removed on close: Leaflet measures its container on
  // creation, and a hidden modal measures zero.
  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (!el) return
    const map = L.map(el, { zoomControl: true, attributionControl: true })
    map.setView([home.latDeg, home.lonDeg], FALLBACK_ZOOM)
    baseRef.current = createCachedTileLayer(layerById(layerId)).addTo(map)
    const marker = L.marker([home.latDeg, home.lonDeg], { draggable: true }).addTo(map)
    markerRef.current = marker
    mapRef.current = map

    const place = (ll: L.LatLng) => {
      marker.setLatLng(ll)
      void applyPoint(ll.lat, ll.lng)
    }
    map.on('click', (e: L.LeafletMouseEvent) => place(e.latlng))
    marker.on('dragend', () => place(marker.getLatLng()))

    // The modal animates in, so the container has its final size a frame
    // after this runs; without the nudge Leaflet renders a strip of tiles.
    const t = setTimeout(() => map.invalidateSize(), 60)
    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      baseRef.current = null
    }
    // Keyed on `open` alone: `home` and `layerId` only set the opening view,
    // and the effects below handle later changes without rebuilding the map.
  }, [open])

  // Swapping imagery keeps the view; only the tiles change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    baseRef.current?.remove()
    baseRef.current = createCachedTileLayer(layerById(layerId)).addTo(map)
    saveBaseLayer(layerId)
  }, [layerId])

  /** The marker's icon carries the heading, so it redraws when either moves. */
  useEffect(() => {
    markerRef.current?.setIcon(fieldIcon(home.headingDeg))
  }, [home.headingDeg, open])

  /**
   * Move home and look up the ground elevation. The coordinates update
   * before the tile fetch completes so the marker responds at once.
   */
  async function applyPoint(latDeg: number, lonDeg: number) {
    setHome((h) => ({ ...h, latDeg, lonDeg }))
    setLookingUp(true)
    try {
      // terrain speaks lat/lon; SimHome speaks latDeg/lonDeg.
      const at = { lat: latDeg, lon: lonDeg }
      const grids = await loadTerrain([at])
      const raw = sampleElevation(grids, at)
      // Only overwrite when the raster answered. `groundLevel` clamps
      // Terrarium's bathymetry to sea level.
      if (raw !== null) setHome((h) => ({ ...h, altM: Math.round(groundLevel(raw)) }))
    } catch {
      // Keep the previous altitude; it is still editable.
    } finally {
      setLookingUp(false)
    }
  }

  function close() {
    setOpen(false)
    // Return to the tray.
    setSimTrayOpen(true)
  }

  return (
    <LaModal
      open={open}
      wide
      title="Pick a flying field"
      actions={
        <>
          <LaButton variant="ghost" onClick={close}>
            Cancel
          </LaButton>
          <LaButton
            variant="primary"
            onClick={() => {
              setHomeText(formatHome(home))
              close()
            }}
          >
            Use this field
          </LaButton>
        </>
      }
    >
      <div className="field-picker">
        <div className="field-picker__map" ref={containerRef} />
        <div className="field-picker__bar">
          <div className="field-picker__layers" role="group" aria-label="Imagery">
            {BASE_LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`field-picker__layer${layerId === l.id ? ' is-active' : ''}`}
                aria-pressed={layerId === l.id}
                onClick={() => setLayerId(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          {/* No min or max: the browser would clamp the stepper at 0 instead
              of letting `wrapHeading` turn -1 into 359. */}
          <LaField label="Heading" unit="°" htmlFor="field-heading">
            <LaInput
              id="field-heading"
              type="number"
              step={1}
              value={String(home.headingDeg)}
              onChange={(e) => {
                // An empty field is mid-edit, not a heading of zero.
                if (e.target.value.trim() === '') return
                const v = Number(e.target.value)
                if (Number.isFinite(v)) setHome((h) => ({ ...h, headingDeg: wrapHeading(v) }))
              }}
            />
          </LaField>
          <LaField label="Altitude" unit="m AMSL" htmlFor="field-alt">
            <LaInput
              id="field-alt"
              type="number"
              step={1}
              value={String(home.altM)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) setHome((h) => ({ ...h, altM: v }))
              }}
            />
          </LaField>
        </div>
        <LaHint>
          {lookingUp
            ? 'Looking up the ground elevation…'
            : `${home.latDeg.toFixed(6)}, ${home.lonDeg.toFixed(6)} — click or drag to move. Turn the arrow to match the runway; with RealFlight that heading is what lines its scenery up with the map.`}
        </LaHint>
      </div>
    </LaModal>
  )
}

/** Any number of degrees, brought back onto the compass: -1 is 359, 360 is 0. */
export function wrapHeading(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/**
 * The marker: a point with a heading arrow, pivoting on the exact coordinate
 * so it can be lined up with a runway.
 */
function fieldIcon(headingDeg: number): L.DivIcon {
  return L.divIcon({
    className: 'field-picker__marker',
    html: `<svg width="64" height="64" viewBox="-32 -32 64 64">
      <g transform="rotate(${headingDeg})">
        <path d="M0 -26 L6 -12 L1.6 -12 L1.6 0 L-1.6 0 L-1.6 -12 L-6 -12 Z"
              fill="#F7941D" stroke="#2D2D2F" stroke-width="1.2"/>
      </g>
      <circle r="4.5" fill="#F7941D" stroke="#fff" stroke-width="2"/>
    </svg>`,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  })
}
