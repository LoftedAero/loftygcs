import L from 'leaflet'
import { isClose, targetLabel, type RelativeTarget } from '../../../stores/traffic-store'
import { distanceLabel, toDistance, type DistanceUnit } from '../../../units'

// Other aircraft on the flying map, as Leaflet markers (tens of objects that
// move once a second). Each shows its heading, its height relative to this
// vehicle, and its name, with the height beside the symbol rather than in a
// tooltip.

/**
 * An aeroplane silhouette from above, nose at -Y so `rotate(heading)` points
 * it along the track, symmetric about X. A target with no heading gets a
 * diamond instead, rather than a direction invented from missing data.
 */
const PLANFORM =
  'M0 -11 L1.6 -6 L1.6 -2 L10 3 L10 5.2 L1.6 3.2 L1.6 7.5 L4 9.6 L4 11 ' +
  'L0 10 L-4 11 L-4 9.6 L-1.6 7.5 L-1.6 3.2 L-10 5.2 L-10 3 L-1.6 -2 L-1.6 -6 Z'

function trafficIcon(t: RelativeTarget, unit: DistanceUnit): L.DivIcon {
  const close = isClose(t)
  // --la-bad and --la-ink-2 as literals, since these are SVG attributes
  // rather than CSS; keep them in step with the tokens.
  const fill = close ? '#D63031' : '#2D2D2F'
  const shape =
    t.headingDeg !== null
      ? `<path d="${PLANFORM}" fill="${fill}" stroke="#fff" stroke-width="1.2"
              stroke-linejoin="round" transform="rotate(${t.headingDeg.toFixed(0)})"/>`
      : `<path d="M0 -7 L7 0 L0 7 L-7 0 Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`
  const label = escapeHtml(targetLabel(t))
  const alt = altLabel(t, unit)
  return L.divIcon({
    className: 'traffic-marker',
    html: `<svg width="26" height="26" viewBox="-13 -13 26 26">${shape}</svg>
      <span class="traffic-marker__tag${close ? ' is-close' : ''}">${label}${
        alt ? `<b>${alt}</b>` : ''
      }</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

/**
 * Height relative to this vehicle when it has a fix, otherwise the aircraft's
 * own AMSL altitude, in the user's distance unit. Blank when unknown, since
 * "±0" would claim co-altitude.
 */
function altLabel(t: RelativeTarget, unit: DistanceUnit): string {
  if (t.relative) {
    if (t.relAltM === null) return ''
    const v = Math.round(toDistance(t.relAltM, unit))
    const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
    return `${sign}${Math.abs(v)} ${distanceLabel(unit)}`
  }
  if (t.altMslM === null) return ''
  return `${Math.round(toDistance(t.altMslM, unit))} ${distanceLabel(unit)}`
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  )
}

/**
 * The traffic markers, updated in place and keyed on ICAO address so a
 * moving aircraft keeps its marker instead of flickering.
 */
export class TrafficLayer {
  private group: L.LayerGroup
  private markers = new Map<number, L.Marker>()

  constructor(map: L.Map) {
    this.group = L.layerGroup().addTo(map)
  }

  update(targets: readonly RelativeTarget[], unit: DistanceUnit) {
    const seen = new Set<number>()
    for (const t of targets) {
      seen.add(t.icao)
      const pos: L.LatLngExpression = [t.latDeg, t.lonDeg]
      const existing = this.markers.get(t.icao)
      if (existing) {
        existing.setLatLng(pos)
        existing.setIcon(trafficIcon(t, unit))
      } else {
        this.markers.set(t.icao, L.marker(pos, { icon: trafficIcon(t, unit) }).addTo(this.group))
      }
    }
    for (const [icao, marker] of this.markers) {
      if (seen.has(icao)) continue
      marker.remove()
      this.markers.delete(icao)
    }
  }

  remove() {
    this.group.remove()
    this.markers.clear()
  }
}
