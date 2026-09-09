import { useEffect, useRef, useState } from 'react'
import { LaCard } from '../../components/La'
import VehicleView from '../../components/VehicleView'
import { AttitudeIndicator, HeadingDial } from '../../components/Instruments'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { vehicleClass } from '../../../protocol/modes'
import { decodeSensors, type SensorState } from '../../../protocol/sensors'
import { isElectron } from '../../../env'

const GPS_FIX_NAMES = ['No GPS', 'No fix', '2D fix', '3D fix', 'DGPS', 'RTK float', 'RTK fixed']

/** Whether anything is actually driving these readouts. */
function useLive(): boolean {
  return useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
}

// The live half of the Overview, in the shape of Betaflight's setup tab: the
// airframe turning with the vehicle, instruments and vital signs beside it.
export default function LiveVehiclePanel() {
  const live = useLive()
  const mavType = useVehicleStore((s) => s.vehicleType)
  const airframe = useVehicleStore((s) => s.airframe)
  return (
    <div className="live-panel">
      <LaCard title="Attitude" className="live-panel__model">
        {/* The readout is wrapped with the well rather than placed against
            the card, so its inset is measured from the thing it sits on. It
            used to be positioned with a hardcoded top that guessed where
            the title ended, and the guess drifted -- it was overhanging the
            well's top edge by 8px. */}
        <div className="model-well">
          <AttitudeReadout />
          {/* The instruments beside this one sit level with no data, because
            that is what an instrument does. A *model* is not an instrument:
            an unidentified vehicle falls back to the fixed wing, so drawing
            it would announce an aeroplane nobody has connected -- and would
            run a WebGL loop to say it. The well stays, empty. */}
          {live ? (
            <VehicleView
              vehicle={vehicleClass(mavType)}
              airframe={airframe}
              attitude={() => ({
                roll: telemetryRings.rollRad.latest(),
                pitch: telemetryRings.pitchRad.latest(),
                yaw: telemetryRings.yawRad.latest(),
              })}
            />
          ) : (
            <div className="vehicle-view vehicle-view--empty">
              {/* The one place the disconnected state is stated, because it
                is the one place the absence is already visible. It names
                the route out and where it is, since neither the app bar's
                transport menu nor the SITL tray announces itself -- and it
                names the right one: the simulator is an Electron feature
                (it spawns a native binary), so in a browser the way to see
                the app move is the Demo transport, which is exactly why
                that transport still exists. */}
              <p className="vehicle-view__empty-title">No vehicle</p>
              <p className="vehicle-view__empty-hint">
                {isElectron()
                  ? 'Connect one from the app bar, or start a simulator from the SITL tray.'
                  : 'Connect one from the app bar — or choose Demo there to fly a simulated aircraft with no hardware.'}
              </p>
            </div>
          )}
        </div>
        {/* Hidden with the model, not just for the F-35B: the CC-BY credit
            is owed for *showing* the biplane, and a credit under an empty
            well names a model that is not on screen. */}
        <p className="la-card__note model-credit" hidden={!live || airframe === 'f35b'}>
          Aircraft model:{' '}
          <a
            href="https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5"
            target="_blank"
            rel="noreferrer noopener"
          >
            Low-Poly Biplane
          </a>{' '}
          by lord_syrup, CC-BY-4.0. Multirotor model from Betaflight Configurator (GPL-3.0).
        </p>
      </LaCard>

      <div className="live-panel__side">
        <LaCard title="Instruments">
          <div className="instrument-row">
            <AttitudeIndicator />
            <HeadingDial />
          </div>
        </LaCard>
        <GpsCard />
        <SystemCard />
        <SensorCard />
      </div>
    </div>
  )
}

/** Yaw/pitch/roll in degrees, sampled off the rings a few times a second. */
function AttitudeReadout() {
  const live = useLive()
  // null rather than zeros: the rings hold whatever the last vehicle left
  // in them, so a disconnect would otherwise freeze three plausible angles
  // on screen forever.
  const [angles, setAngles] = useState<{ yaw: number; pitch: number; roll: number } | null>(null)
  const frame = useRef(0)
  useEffect(() => {
    if (!live) {
      setAngles(null)
      return
    }
    let last = 0
    const tick = (now: number) => {
      frame.current = requestAnimationFrame(tick)
      // Numbers only need to be readable, not smooth; 8 Hz is plenty and
      // keeps React out of the render loop.
      if (now - last < 125) return
      last = now
      const deg = (r: number) => (r * 180) / Math.PI
      setAngles({
        yaw: (deg(telemetryRings.yawRad.latest()) + 360) % 360,
        pitch: deg(telemetryRings.pitchRad.latest()),
        roll: deg(telemetryRings.rollRad.latest()),
      })
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [live])
  const angle = (pick: (a: { yaw: number; pitch: number; roll: number }) => number, dp: number) =>
    angles ? `${pick(angles).toFixed(dp)}°` : '—'
  return (
    <dl className="attitude-readout">
      <div>
        <dt>Yaw</dt>
        <dd>{angle((a) => a.yaw, 0)}</dd>
      </div>
      <div>
        <dt>Pitch</dt>
        <dd>{angle((a) => a.pitch, 1)}</dd>
      </div>
      <div>
        <dt>Roll</dt>
        <dd>{angle((a) => a.roll, 1)}</dd>
      </div>
    </dl>
  )
}

/**
 * One reading, where `null` means nothing is saying.
 *
 * That is a different thing from a zero, and the difference is the whole
 * point of drawing this screen without a vehicle: "Satellites 0" and a
 * green "Armed: Disarmed" are claims about an aircraft, and with nothing
 * connected there is no aircraft to make them of. So a null takes the tone
 * down with the value -- otherwise the column goes green for a vehicle that
 * is not there, which is the one direction a safety readout must not fail.
 */
function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | null
  tone?: 'ok' | 'bad'
}) {
  const shown = value ?? '—'
  const t = value === null ? undefined : tone
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className={t ? `stat-row__value stat-row__value--${t}` : 'stat-row__value'}>
        {shown}
      </span>
    </div>
  )
}

function GpsCard() {
  const live = useLive()
  const fix = useVehicleStore((s) => s.gpsFix)
  const sats = useVehicleStore((s) => s.gpsSats)
  const hdop = useVehicleStore((s) => s.gpsHdop)
  const lat = useVehicleStore((s) => s.latDeg)
  const lon = useVehicleStore((s) => s.lonDeg)
  return (
    <LaCard title="GPS">
      <Stat
        label="3D fix"
        value={live ? (fix >= 3 ? 'Yes' : 'No') : null}
        tone={fix >= 3 ? 'ok' : 'bad'}
      />
      <Stat label="Fix type" value={live ? (GPS_FIX_NAMES[fix] ?? String(fix)) : null} />
      <Stat label="Satellites" value={live ? String(sats) : null} />
      <Stat label="HDOP" value={live && hdop > 0 ? hdop.toFixed(2) : null} />
      <Stat label="Latitude" value={live && lat !== 0 ? lat.toFixed(6) : null} />
      <Stat label="Longitude" value={live && lon !== 0 ? lon.toFixed(6) : null} />
    </LaCard>
  )
}

function SystemCard() {
  const live = useLive()
  const v = useVehicleStore()
  const stats = useConnectionStore((s) => s.linkStats)
  // ArduPilot reports why it will not arm through PreArm status lines; the
  // most recent one is the actionable thing to show.
  const prearm = [...v.statusTexts].reverse().find((s) => /^PreArm|^Arm:/i.test(s.text))
  return (
    <LaCard title="System">
      <Stat label="Vehicle" value={live ? v.vehicleName || null : null} />
      <Stat label="Flight mode" value={live ? v.modeName || null : null} />
      <Stat
        label="Armed"
        value={live ? (v.armed ? 'Armed' : 'Disarmed') : null}
        tone={v.armed ? 'bad' : 'ok'}
      />
      <Stat label="Battery" value={live && v.batteryV > 0 ? `${v.batteryV.toFixed(2)} V` : null} />
      <Stat
        label="Current"
        value={live ? (v.batteryA >= 0 ? `${v.batteryA.toFixed(1)} A` : 'not measured') : null}
      />
      <Stat label="Remaining" value={live && v.batteryPct >= 0 ? `${v.batteryPct} %` : null} />
      <Stat label="Link" value={live && stats ? `${stats.rxCount} msg/s` : null} />
      {prearm && <p className="la-hint la-hint--error">{prearm.text}</p>}
    </LaCard>
  )
}

const SENSOR_TONE: Record<SensorState, { text: string; tone?: 'ok' | 'bad' }> = {
  healthy: { text: 'OK', tone: 'ok' },
  unhealthy: { text: 'Unhealthy', tone: 'bad' },
  disabled: { text: 'Disabled' },
  absent: { text: 'Absent' },
}

function SensorCard() {
  const live = useLive()
  const present = useVehicleStore((s) => s.sensorsPresent)
  const enabled = useVehicleStore((s) => s.sensorsEnabled)
  const health = useVehicleStore((s) => s.sensorsHealth)
  const readings = decodeSensors(present, enabled, health)
  return (
    // No footnote: the list only ever contains sensors the board reports as
    // fitted, and the column has no vertical space to spend explaining that.
    <LaCard title="Sensors">
      {/* The one card that cannot show empty rows: the list is whatever the
          board reports as fitted, so with no board there is nothing to name
          -- and naming the usual suspects would invent them. */}
      {!live ? (
        <p className="app-placeholder">No vehicle.</p>
      ) : readings.length === 0 ? (
        <p className="app-placeholder">The vehicle has not reported its sensor status yet.</p>
      ) : (
        readings.map((r) => {
          const t = SENSOR_TONE[r.state]
          return (
            <Stat key={r.id} label={r.label} value={t.text} {...(t.tone ? { tone: t.tone } : {})} />
          )
        })
      )}
    </LaCard>
  )
}
