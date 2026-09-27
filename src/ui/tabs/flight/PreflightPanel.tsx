import { useEffect, useState } from 'react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { decodeSensors, SENSOR_BITS } from '../../../protocol/sensors'
import { prearmFailures } from '../../../protocol/prearm'
import { armReadiness } from './hud-draw'

// "Why won't it arm", answered in one place: the prearm bit, ArduPilot's
// reported reasons, and any unhealthy sensors. The reasons come first; the
// sensors cover the case where the vehicle has not said why.

/** Reasons age out after a minute, so the view refreshes to notice. */
const TICK_MS = 2000

export default function PreflightPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const armed = useVehicleStore((s) => s.armed)
  const present = useVehicleStore((s) => s.sensorsPresent)
  const enabled = useVehicleStore((s) => s.sensorsEnabled)
  const health = useVehicleStore((s) => s.sensorsHealth)
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  if (!connected) {
    // The same wording as the Messages and Status panes.
    return <p className="app-placeholder">Waiting for telemetry…</p>
  }

  const readiness = armReadiness(armed, present, health, SENSOR_BITS.prearm)
  const failures = prearmFailures(statusTexts, Date.now())
  const sensors = decodeSensors(present, enabled, health)
  const unhealthy = sensors.filter((s) => s.state === 'unhealthy')

  const headline =
    readiness === 'armed'
      ? 'Armed'
      : readiness === 'ready'
        ? 'Ready to arm'
        : readiness === 'notReady'
          ? 'Not ready to arm'
          : 'Arming state not reported'

  return (
    <div className="preflight">
      <div className={`preflight__state preflight__state--${readiness}`}>
        <span className="preflight__dot" aria-hidden="true" />
        {headline}
      </div>

      {failures.length > 0 ? (
        <ul className="preflight__list">
          {failures.map((f) => (
            <li key={f.reason}>{f.reason}</li>
          ))}
        </ul>
      ) : readiness === 'notReady' ? (
        // Not ready, with no reason heard yet (the GCS connected after it
        // went past). ArduPilot repeats reasons about every thirty seconds.
        <p className="preflight__note">The vehicle reports an unspecified failing check.</p>
      ) : (
        <p className="preflight__note">
          {readiness === 'armed'
            ? 'Checks passed and the vehicle is armed.'
            : readiness === 'ready'
              ? 'All arming checks are passing.'
              : 'This firmware does not report a prearm check.'}
        </p>
      )}

      {unhealthy.length > 0 && (
        <div className="preflight__sensors">
          <h4 className="preflight__head">Unhealthy sensors</h4>
          <ul className="preflight__list">
            {unhealthy.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
