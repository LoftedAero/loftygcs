import { useEffect, useState } from 'react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { decodeSensors, SENSOR_BITS } from '../../../protocol/sensors'
import { currentFailures, prearmFailures } from '../../../protocol/prearm'
import { checkRows, type CheckStatus } from '../../../protocol/arming-checks'
import { vehicleClass } from '../../../protocol/modes'
import { connectionService } from '../../../services/connection'
import { armReadiness } from './hud-draw'

const MAV_CMD_RUN_PREARM_CHECKS = 401

/**
 * The vehicle answers a check request with a message per failing check, which
 * a slow radio link feels, and repeats them itself every thirty seconds. So
 * the panel asks at most that often, however often it opens. Module scope,
 * because compact mode mounts the panel each time it opens.
 */
const PREARM_REQUEST_MS = 30_000
let lastPrearmRequest = -Infinity
// A new link, or the vehicle restarting, is a new set of checks to hear.
useConnectionStore.subscribe((s, prev) => {
  if (s.phase !== prev.phase && (s.phase === 'opening' || s.phase === 'rebooting')) {
    lastPrearmRequest = -Infinity
  }
})

const STATUS_TEXT: Record<CheckStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  skipped: 'Skipped',
  unknown: '-',
}

// "Why won't it arm", answered in one place: the prearm bit, ArduPilot's
// reported reasons, every arming check, and any unhealthy sensors. The checks
// come first because they are one shape whatever passes; the reasons and the
// sensors, which come and go, follow them so nothing moves the grid. The
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
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const skipchk = useParamStore((s) => s.entries.get('ARMING_SKIPCHK')?.value)
  const armingCheck = useParamStore((s) => s.entries.get('ARMING_CHECK')?.value)
  const [, tick] = useState(0)
  const readiness = armReadiness(armed, present, health, SENSOR_BITS.prearm)

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // ArduPilot repeats its reasons only every thirty seconds, so a check list
  // opened between repeats would read "-" for want of news. Asking the
  // vehicle to run its checks now makes it report every failing one at once.
  useEffect(() => {
    if (!connected || readiness !== 'notReady') return
    const now = Date.now()
    if (now - lastPrearmRequest < PREARM_REQUEST_MS) return
    lastPrearmRequest = now
    connectionService.runCommand(MAV_CMD_RUN_PREARM_CHECKS, [], 2000).catch(() => {})
  }, [connected, readiness])

  if (!connected) {
    // The same wording as the Messages and Status panes.
    return <p className="app-placeholder">Waiting for telemetry…</p>
  }

  const now = Date.now()
  const failures = currentFailures(statusTexts, now, readiness)
  const sensors = decodeSensors(present, enabled, health)
  const unhealthy = sensors.filter((s) => s.state === 'unhealthy')
  // The grid weighs every recent reason against the verdict itself.
  const checks = checkRows(
    prearmFailures(statusTexts, now).map((f) => f.reason),
    vehicleClass(vehicleType) === 'plane' ? 'plane' : 'other',
    skipchk,
    armingCheck,
    readiness,
  )

  // ArduPilot sends no SYS_STATUS until it has started, so for the first
  // seconds of a connection no sensor is reported at all; that is waiting,
  // not firmware without a prearm bit.
  const headline =
    readiness === 'armed'
      ? 'Armed'
      : readiness === 'ready'
        ? 'Ready to arm'
        : readiness === 'notReady'
          ? 'Not ready to arm'
          : present === 0
            ? 'Waiting for the arming state…'
            : 'Arming state not reported'

  return (
    <div className="preflight">
      <div className={`preflight__state preflight__state--${readiness}`}>
        <span className="preflight__dot" aria-hidden="true" />
        {headline}
      </div>

      <div>
        <h4 className="preflight__head">Arming checks</h4>
        <ul className="preflight__checks">
          {checks.map((c) => (
            <li
              key={c.label}
              className={`preflight__check preflight__check--${c.status}`}
              title={c.reasons.join('\n') || undefined}
            >
              <span className="preflight__dot" aria-hidden="true" />
              <span className="preflight__check-name">{c.label}</span>
              <span className="preflight__check-status">{STATUS_TEXT[c.status]}</span>
            </li>
          ))}
        </ul>
      </div>

      {(failures.length > 0 || readiness === 'notReady') && (
        <div>
          <h4 className="preflight__head">Messages</h4>
          {failures.length > 0 ? (
            <ul className="preflight__list">
              {failures.map((f) => (
                <li key={f.reason}>{f.reason}</li>
              ))}
            </ul>
          ) : (
            // Not ready, with no reason heard yet: the GCS connected after it
            // went past, and the request for a fresh set is on its way.
            <p className="preflight__note">No reason reported yet</p>
          )}
        </div>
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
