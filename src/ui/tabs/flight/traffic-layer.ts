import L from 'leaflet'
import { isClose, targetLabel, type RelativeTarget } from '../../../stores/traffic-store'

// Other aircraft on the flying map.
//
// Markers rather than a canvas: this is tens of objects that move once a
// second, not the per-frame path the vehicle's own trail is, and Leaflet's
// marker layer already handles panning and zoom for free.
//
// What a marker has to say, in the order it is read: which way it is
// pointing, how far above or below you it is, and what it is called. The
// height is the number that decides whether a contact matters -- a
// thousand feet of separation is a non-event and two hundred is not -- so
// it sits beside the symbol rather than in a tooltip nobody opens while
// flying.

/**
 * A chevron pointing where the aircraft is going, or a diamond when the
 * report carried no heading -- a chevron pointing north because nothing said
 * otherwise is a direction invented from missing data, and on a traffic
 * display that is the one thing not to do.
 */
function trafficIcon(t: RelativeTarget): L.DivIcon {
  const close = isClose(t)
  // Status colors, used here as status: --la-bad and --la-ink-2. Leaflet
  // takes colors as options rather than through CSS, so they are literals
  // and must change with the tokens.
  const fill = close ? '#D63031' : '#2D2D2F'
  const shape =
    t.headingDeg !== null
      ? `<path d="M0 -9 L6 7 L0 3 L-6 7 Z" fill="${fill}" stroke="#fff" stroke-width="1.5"
              transform="rotate(${t.headingDeg.toFixed(0)})"/>`
      : `<path d="M0 -7 L7 0 L0 7 L-7 0 Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`
  const label = escapeHtml(targetLabel(t))
  const alt = relAltLabel(t)
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
 * Height above this vehicle, in the form a pilot reads it: a sign, then
 * hundreds of feet. Blank when either altitude is unknown -- "+00" would
 * claim co-altitude, which is exactly the contact you would want to be sure
 * about before believing.
 */
function relAltLabel(t: RelativeTarget): string {
  if (t.relAltM === null) return ''
  const hundredsFt = Math.round((t.relAltM * 3.28084) / 100)
  if (hundredsFt === 0) return '±00'
  return `${hundredsFt > 0 ? '+' : '−'}${String(Math.abs(hundredsFt)).padStart(2, '0')}`
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  )
}

/**
 * The traffic markers, updated in place.
 *
 * Keyed on the ICAO address so a moving aircraft keeps its marker rather
 * than being removed and re-added -- which would restart Leaflet's own
 * transitions and make the whole picture flicker once a second.
 */
export class TrafficLayer {
  private group: L.LayerGroup
  private markers = new Map<number, L.Marker>()

  constructor(map: L.Map) {
    this.group = L.layerGroup().addTo(map)
  }

  update(targets: readonly RelativeTarget[]) {
    const seen = new Set<number>()
    for (const t of targets) {
      seen.add(t.icao)
      const pos: L.LatLngExpression = [t.latDeg, t.lonDeg]
      const existing = this.markers.get(t.icao)
      if (existing) {
        existing.setLatLng(pos)
        existing.setIcon(trafficIcon(t))
      } else {
        this.markers.set(t.icao, L.marker(pos, { icon: trafficIcon(t) }).addTo(this.group))
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
