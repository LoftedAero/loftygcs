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

// Pick where the simulated vehicle boots by pointing at it.
//
// Typing a latitude and a longitude is the one part of setting up a
// simulator that needs a second window open, and the numbers are the part
// nobody can check by eye: a transposed digit still parses, and the vehicle
// boots in a field a hundred kilometers away looking perfectly healthy.
// Pointing at the place is self-verifying -- you can see the runway.
//
// Two things this carries that a coordinate pair typed from a map does not:
//
// *The heading.* With RealFlight, `--home`'s yaw is what lines the scenery's
// runway up with the map, so it is not a detail (see CLAUDE.md). It is set
// here by turning an arrow drawn over the imagery until it matches the
// runway underneath, which is the comparison someone actually wants to make
// and cannot make against a number.
//
// *The altitude.* It is AMSL and it is the EKF origin, and almost nobody
// knows their field's elevation offhand. The same Terrarium tiles the
// mission profile uses have it, so it is looked up rather than asked for --
// and left editable, because a surveyed number beats a 38 m raster sample.
//
// Rendered from App, not from the tray that opens it: the tray dismisses on
// any outside click, and a picker mounted inside it would unmount the
// moment someone clicked the map. Opening it closes the tray and closing it
// puts the tray back, so the round trip lands where it started.

/** Where a picker with nothing to go on starts. */
const FALLBACK_ZOOM = 17

export default function SimFieldPicker() {
  const open = useUiStore((s) => s.fieldPickerOpen)
  const setOpen = useUiStore((s) => s.setFieldPickerOpen)
  const setSimTrayOpen = useUiStore((s) => s.setSimTrayOpen)
  const homeText = useHomeText()
  const setHomeText = useSimStore((s) => s.setHomeText)
  // Which default an unset home would boot at, so the picker opens over the
  // same place the tray says it would rather than somewhere else entirely.
  const physics = useSimStore((s) => s.physics)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const baseRef = useRef<L.TileLayer | null>(null)

  const [layerId, setLayerId] = useState<BaseLayerId>(loadBaseLayer)
  const [home, setHome] = useState<SimHome>(() => defaultHome(physics.kind))
  /** Null while a lookup is in flight, so the field can say so. */
  const [lookingUp, setLookingUp] = useState(false)

  // Seed from whatever the tray currently holds, each time it opens -- the
  // picker is a way of editing that value, not a separate one.
  useEffect(() => {
    if (!open) return
    const parsed = parseHome(homeText)
    setHome('home' in parsed ? parsed.home : defaultHome(physics.kind))
    // Keyed on `open` alone, deliberately: re-seeding from homeText while
    // the dialog is up would fight the marker someone is dragging.
  }, [open])

  // The map is built when the dialog opens and torn down when it closes.
  // Leaflet measures its container on creation, and a container inside a
  // hidden modal measures zero -- so there is nothing to keep alive between
  // openings anyway.
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
    // Keyed on `open` alone: `home` and `layerId` are read once to place the
    // opening view, and re-running this on either would rebuild the map
    // under the person using it. Later changes are handled by the effects
    // below, which move the map rather than replace it.
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
   * Move home, and look the ground up under it.
   *
   * The elevation is not awaited before the coordinates land: a tile fetch
   * is a network round trip, and a marker that does not move until it
   * finishes reads as a dropped click.
   */
  async function applyPoint(latDeg: number, lonDeg: number) {
    setHome((h) => ({ ...h, latDeg, lonDeg }))
    setLookingUp(true)
    try {
      // terrain speaks lat/lon; SimHome speaks latDeg/lonDeg.
      const at = { lat: latDeg, lon: lonDeg }
      const grids = await loadTerrain([at])
      const raw = sampleElevation(grids, at)
      // Only overwrite when the raster actually answered. Terrarium carries
      // bathymetry, so a field beside water reads below zero without the
      // clamp the mission profile already applies.
      if (raw !== null) setHome((h) => ({ ...h, altM: Math.round(groundLevel(raw)) }))
    } catch {
      // An elevation nobody could fetch is not a reason to refuse a
      // location; the altitude stays whatever it was and is editable.
    } finally {
      setLookingUp(false)
    }
  }

  function close() {
    setOpen(false)
    // Back where they came from, with the value they just chose in view.
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
          {/* No min or max, deliberately: a heading is a circle, and bounds
              are what stop the spinner from ever leaving it. With min=0 the
              browser clamps the down arrow at zero and the wrap below never
              sees a value to wrap -- so 0 stepped down stays 0 rather than
              becoming 359. The bounds live in `wrapHeading` instead, which
              also catches a pasted 450 or a negative. */}
          <LaField label="Heading" unit="°" htmlFor="field-heading">
            <LaInput
              id="field-heading"
              type="number"
              step={1}
              value={String(home.headingDeg)}
              onChange={(e) => {
                // An emptied field is mid-edit, not a heading of zero:
                // snapping to 0 there would quietly change where the
                // aircraft points while someone was retyping it.
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
 * The marker: a point with an arrow out of it.
 *
 * Drawn rather than a rotated stock pin because the arrow is the control --
 * it is compared against a runway in the imagery underneath, so it needs a
 * visible nose and a fixed pivot at the exact coordinate.
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
