import { useEffect, useRef, useState } from 'react'
import { LaCard } from '../../components/La'
import VehicleView from '../../components/VehicleView'
import { AttitudeIndicator, HeadingDial } from '../../components/Instruments'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { vehicleClass } from '../../../protocol/modes'
import { decodeSensors, type SensorState } from '../../../protocol/sensors'

const GPS_FIX_NAMES = ['No GPS', 'No fix', '2D fix', '3D fix', 'DGPS', 'RTK float', 'RTK fixed']

// The live half of the Overview, in the shape of Betaflight's setup tab: the
// airframe turning with the vehicle, instruments and vital signs beside it.
export default function LiveVehiclePanel() {
  const mavType = useVehicleStore((s) => s.vehicleType)
  return (
    <div className="live-panel">
      <LaCard title="Attitude" className="live-panel__model">
        <AttitudeReadout />
        <VehicleView
          vehicle={vehicleClass(mavType)}
          attitude={() => ({
            roll: telemetryRings.rollRad.latest(),
            pitch: telemetryRings.pitchRad.latest(),
            yaw: telemetryRings.yawRad.latest(),
          })}
        />
        <p className="la-card__note model-credit">
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
  const [angles, setAngles] = useState({ yaw: 0, pitch: 0, roll: 0 })
  const frame = useRef(0)
  useEffect(() => {
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
  }, [])
  return (
    <dl className="attitude-readout">
      <div>
        <dt>Yaw</dt>
        <dd>{angles.yaw.toFixed(0)}°</dd>
      </div>
      <div>
        <dt>Pitch</dt>
        <dd>{angles.pitch.toFixed(1)}°</dd>
      </div>
      <div>
        <dt>Roll</dt>
        <dd>{angles.roll.toFixed(1)}°</dd>
      </div>
    </dl>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className={tone ? `stat-row__value stat-row__value--${tone}` : 'stat-row__value'}>
        {value}
      </span>
    </div>
  )
}

function GpsCard() {
  const fix = useVehicleStore((s) => s.gpsFix)
  const sats = useVehicleStore((s) => s.gpsSats)
  const hdop = useVehicleStore((s) => s.gpsHdop)
  const lat = useVehicleStore((s) => s.latDeg)
  const lon = useVehicleStore((s) => s.lonDeg)
  return (
    <LaCard title="GPS">
      <Stat
        label="3D fix"
        value={fix >= 3 ? 'Yes' : 'No'}
        tone={fix >= 3 ? 'ok' : 'bad'}
      />
      <Stat label="Fix type" value={GPS_FIX_NAMES[fix] ?? String(fix)} />
      <Stat label="Satellites" value={String(sats)} />
      <Stat label="HDOP" value={hdop > 0 ? hdop.toFixed(2) : '—'} />
      <Stat label="Latitude" value={lat !== 0 ? lat.toFixed(6) : '—'} />
      <Stat label="Longitude" value={lon !== 0 ? lon.toFixed(6) : '—'} />
    </LaCard>
  )
}

function SystemCard() {
  const v = useVehicleStore()
  const stats = useConnectionStore((s) => s.linkStats)
  // ArduPilot reports why it will not arm through PreArm status lines; the
  // most recent one is the actionable thing to show.
  const prearm = [...v.statusTexts].reverse().find((s) => /^PreArm|^Arm:/i.test(s.text))
  return (
    <LaCard title="System">
      <Stat label="Vehicle" value={v.vehicleName || '—'} />
      <Stat label="Flight mode" value={v.modeName || '—'} />
      <Stat
        label="Armed"
        value={v.armed ? 'Armed' : 'Disarmed'}
        tone={v.armed ? 'bad' : 'ok'}
      />
      <Stat label="Battery" value={v.batteryV > 0 ? `${v.batteryV.toFixed(2)} V` : '—'} />
      <Stat label="Current" value={v.batteryA >= 0 ? `${v.batteryA.toFixed(1)} A` : 'not measured'} />
      <Stat label="Remaining" value={v.batteryPct >= 0 ? `${v.batteryPct} %` : '—'} />
      <Stat label="Link" value={stats ? `${stats.rxCount} msg/s` : '—'} />
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
  const present = useVehicleStore((s) => s.sensorsPresent)
  const enabled = useVehicleStore((s) => s.sensorsEnabled)
  const health = useVehicleStore((s) => s.sensorsHealth)
  const readings = decodeSensors(present, enabled, health)
  return (
    // No footnote: the list only ever contains sensors the board reports as
    // fitted, and the column has no vertical space to spend explaining that.
    <LaCard title="Sensors">
      {readings.length === 0 ? (
        <p className="app-placeholder">The vehicle has not reported its sensor status yet.</p>
      ) : (
        readings.map((r) => {
          const t = SENSOR_TONE[r.state]
          return <Stat key={r.id} label={r.label} value={t.text} {...(t.tone ? { tone: t.tone } : {})} />
        })
      )}
    </LaCard>
  )
}
