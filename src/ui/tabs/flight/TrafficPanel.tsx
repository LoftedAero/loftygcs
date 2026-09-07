import { useUnits } from '../../../stores/preferences-store'
import {
  distanceLabel,
  formatSpeed,
  speedLabel,
  toDistance,
  type DistanceUnit,
} from '../../../units'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import {
  EMITTER_LABELS,
  isClose,
  relativeTo,
  targetLabel,
  useTrafficStore,
  type RelativeTarget,
} from '../../../stores/traffic-store'

// The sky around this aircraft, as a list.
//
// The map already draws where the traffic is; this is for the numbers you
// cannot read off a map -- how far, how far above, how fast, and whether the
// receiver has heard from it lately. Nearest first, because on a list of
// aircraft the one that matters is the close one.
//
// It shows what was reported and nothing more. ArduPilot does its own
// avoidance from these same messages (the AVD_* parameters); a station's job
// here is to say what is out there, not to decide what to do about it, and a
// panel that started ranking threats would be claiming an authority it has
// no certification for.

export default function TrafficPanel() {
  const units = useUnits()
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const targets = useTrafficStore((s) => s.targets)
  const everSeen = useTrafficStore((s) => s.everSeen)
  // Three scalars, not one object. A selector that builds an object returns
  // a new identity on every call, so React's snapshot never compares equal
  // and the component re-renders forever -- which does not throw, it just
  // renders nothing, and the pane came up blank with a clean console.
  const latDeg = useVehicleStore((s) => s.latDeg)
  const lonDeg = useVehicleStore((s) => s.lonDeg)
  const altMslM = useVehicleStore((s) => s.altMslM)
  const own = latDeg === 0 && lonDeg === 0 ? null : { latDeg, lonDeg, altMslM }

  if (!connected) {
    return <p className="app-placeholder">Connect a vehicle to see the traffic it hears.</p>
  }

  const rows = relativeTo(targets, own)

  if (rows.length === 0) {
    return (
      <p className="app-placeholder">
        {everSeen
          ? 'No aircraft being heard right now.'
          : 'No ADS-B traffic. This needs a receiver on the vehicle — nothing is reported without one.'}
      </p>
    )
  }

  return (
    <div className="traffic-panel">
      <table className="traffic-table">
        <thead>
          <tr>
            <th>Aircraft</th>
            <th className="traffic-table__num">Range</th>
            <th className="traffic-table__num">Bearing</th>
            <th className="traffic-table__num">Rel. alt</th>
            <th className="traffic-table__num">Speed</th>
            <th>Type</th>
            <th className="traffic-table__num">Heard</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <Row key={t.icao} t={t} unit={units.distance} speed={units.speed} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  t,
  unit,
  speed,
}: {
  t: RelativeTarget
  unit: DistanceUnit
  speed: ReturnType<typeof useUnits>['speed']
}) {
  const close = isClose(t)
  return (
    <tr className={close ? 'is-close' : undefined}>
      <td>
        {targetLabel(t)}
        {/* Said plainly rather than left to be discovered: SIM_ADSB_COUNT
            traffic looks exactly like the real thing on a map. */}
        {t.simulated && <span className="traffic-table__sim">sim</span>}
      </td>
      <td className="traffic-table__num">{range(t.rangeM, unit)}</td>
      <td className="traffic-table__num">
        {t.bearingDeg === null ? '—' : `${t.bearingDeg.toFixed(0).padStart(3, '0')}°`}
      </td>
      <td className="traffic-table__num">{relAlt(t, unit)}</td>
      <td className="traffic-table__num">
        {t.groundSpeedMs === null
          ? '—'
          : `${formatSpeed(t.groundSpeedMs, speed)} ${speedLabel(speed)}`}
      </td>
      <td>{t.onSurface ? 'Surface' : (EMITTER_LABELS[t.emitterType] ?? 'Aircraft')}</td>
      {/* The vehicle's own count of how stale its picture of this aircraft
          is -- the number that says whether a contact is being tracked or
          merely remembered. */}
      <td className="traffic-table__num">{t.sinceHeardS}s</td>
    </tr>
  )
}

/**
 * Height above this vehicle, signed, with the sign kept even at zero.
 *
 * A blank is not zero: "—" means one of the two altitudes was never
 * reported, where 0 means genuinely co-altitude, and those are opposite
 * things to see on a traffic list.
 */
function relAlt(t: RelativeTarget, unit: DistanceUnit): string {
  if (t.relAltM === null) return '—'
  const v = Math.round(toDistance(t.relAltM, unit))
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${Math.abs(v)} ${distanceLabel(unit)}`
}

/**
 * How far away, at the scale traffic actually is.
 *
 * The app's distance unit is meters or feet, which is right for altitudes
 * and useless for range: an aircraft twenty kilometers off reads as "20000
 * m", or worse as "65617 ft". So this steps up to the larger unit that goes
 * with each, and does it here rather than in `units.ts` -- that file is the
 * shared contract for what a stored number converts to, and range is a
 * presentation choice belonging to this one screen.
 */
function range(meters: number | null, unit: DistanceUnit): string {
  if (meters === null) return '—'
  if (unit === 'ft') {
    const ft = toDistance(meters, 'ft')
    if (ft < 5280) return `${Math.round(ft).toLocaleString()} ft`
    return `${(ft / 5280).toFixed(1)} mi`
  }
  if (meters < 1000) return `${Math.round(meters)} ${distanceLabel(unit)}`
  return `${(meters / 1000).toFixed(1)} km`
}
