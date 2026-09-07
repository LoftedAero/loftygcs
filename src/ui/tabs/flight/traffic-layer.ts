import L from 'leaflet'
import { isClose, targetLabel, type RelativeTarget } from '../../../stores/traffic-store'
import { distanceLabel, toDistance, type DistanceUnit } from '../../../units'

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
 * A plan-view aeroplane, nose along the reported track.
 *
 * Drawn as a silhouette rather than the chevron this started as: on a map
 * already carrying a chevron for this vehicle and pins for the mission, one
 * more arrow is a symbol to decode, where an aeroplane is a thing to
 * recognise. Fuselage, swept wings, tailplane -- enough to read at 26 px and
 * no more, which is all a 26 px symbol can carry.
 *
 * A target with no heading gets a diamond instead: an aeroplane pointing
 * north because nothing said otherwise is a direction invented from missing
 * data, and on a traffic display that is the one thing not to do.
 */
/**
 * An aeroplane from above, nose at -Y so a plain `rotate(heading)` points it
 * along the track: nose, swept wings back to the trailing edge, a slim tail
 * boom, then the tailplane. Symmetric about X by construction -- an
 * asymmetric aircraft symbol reads as a turn that is not happening.
 */
const PLANFORM =
  'M0 -11 L1.6 -6 L1.6 -2 L10 3 L10 5.2 L1.6 3.2 L1.6 7.5 L4 9.6 L4 11 ' +
  'L0 10 L-4 11 L-4 9.6 L-1.6 7.5 L-1.6 3.2 L-10 5.2 L-10 3 L-1.6 -2 L-1.6 -6 Z'

function trafficIcon(t: RelativeTarget, unit: DistanceUnit): L.DivIcon {
  const close = isClose(t)
  // Status colors, used here as status: --la-bad and --la-ink-2. Leaflet
  // takes colors as options rather than through CSS, so they are literals
  // and must change with the tokens.
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
 * How high, in whichever sense there is one -- signed above this vehicle
 * when it knows where it is, and the aircraft's own AMSL figure when it does
 * not. The same rule and the same words as the Traffic list, so the map and
 * the list never disagree about a number.
 *
 * Written in the user's own unit rather than the hundreds-of-feet a
 * transponder display would use. This one started in feet on the grounds
 * that a pilot reads them, which quietly ignored the app's unit preference
 * -- the rule everywhere else here is that a stored number converts at the
 * edge and nowhere else.
 *
 * Blank when nothing is known: "±0" would claim co-altitude, which is
 * exactly the contact worth being sure about before believing.
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
