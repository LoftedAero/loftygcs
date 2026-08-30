import { useEffect, useRef, useState } from 'react'
import { LaButton, LaCard, LaModal, LaSwitch } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { gotoGuided } from '../../../services/flight'
import MapView from './MapView'
import Hud from './Hud'

// The flight screen: map left, HUD + messages right. Arm/mode/takeoff live
// in the action bar (FlightActions) so they never scroll out of reach.
export default function FlightTab() {
  const phase = useConnectionStore((s) => s.phase)
  const [follow, setFollow] = useState(true)
  const [pendingGoto, setPendingGoto] = useState<{ lat: number; lon: number } | null>(null)
  const modeName = useVehicleStore((s) => s.modeName)
  const armed = useVehicleStore((s) => s.armed)

  if (phase !== 'connected' && phase !== 'linkLost') {
    return (
      <LaCard title="Flight" note="Connect a vehicle (or start demo mode) to fly.">
        <p className="app-placeholder">
          Live map with vehicle trail, artificial horizon, status messages, and guided
          click-to-go.
        </p>
      </LaCard>
    )
  }

  return (
    <div className="flight-layout">
      <LaCard title="Map" className="flight-map-card">
        <div className="la-row">
          <LaSwitch label="Follow vehicle" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        </div>
        <MapView follow={follow} onMapClick={(lat, lon) => setPendingGoto({ lat, lon })} />
        <p className="la-card__note">
          {modeName === 'Guided'
            ? 'Click the map to fly there.'
            : 'Click-to-go needs Guided mode (set it in the action bar).'}
        </p>
      </LaCard>
      <div className="flight-side">
        <LaCard title="Horizon" className="flight-hud-card">
          <Hud />
        </LaCard>
        <FlightMessages />
      </div>
      {pendingGoto && (
        <LaModal
          open
          title="Fly here?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setPendingGoto(null)}>
                Cancel
              </LaButton>
              <LaButton
                variant="primary"
                disabled={modeName !== 'Guided' || !armed}
                onClick={() => {
                  gotoGuided(pendingGoto.lat, pendingGoto.lon)
                  setPendingGoto(null)
                }}
              >
                Fly to point
              </LaButton>
            </>
          }
        >
          <p>
            {pendingGoto.lat.toFixed(6)}, {pendingGoto.lon.toFixed(6)} at the current altitude.
            {modeName !== 'Guided' && ' The vehicle is not in Guided mode.'}
            {!armed && ' The vehicle is not armed.'}
          </p>
        </LaModal>
      )}
    </div>
  )
}

function FlightMessages() {
  const statusTexts = useVehicleStore((s) => s.statusTexts)
  const logRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [statusTexts])
  return (
    <LaCard title="Messages" className="flight-messages-card">
      <textarea
        ref={logRef}
        className="la-log flight-log"
        readOnly
        value={statusTexts.map((s) => s.text).join('\n')}
      />
    </LaCard>
  )
}
