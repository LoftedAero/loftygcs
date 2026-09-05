import { LaButton, LaCard } from '../../components/La'
import { BRAND } from '../../../brand'
import { useConnectionStore } from '../../../stores/connection-store'
import { useUiStore } from '../../../stores/ui-store'
import { connectionService } from '../../../services/connection'
import LiveVehiclePanel from './LiveVehiclePanel'

// The landing screen: what the vehicle is doing right now, in the shape of
// Betaflight's setup tab. Configuration lives in the rail beside it, so this
// stays a status screen rather than another form.
export default function OverviewTab() {
  const phase = useConnectionStore((s) => s.phase)
  const setSimTrayOpen = useUiStore((s) => s.setSimTrayOpen)
  const connected = phase === 'connected' || phase === 'linkLost'

  if (!connected) {
    return (
      <LaCard title={BRAND.name} subtitle={BRAND.tagline}>
        <p className="app-placeholder">
          A cross-platform ground station for ArduPilot: guided setup and calibration in the style
          of the Betaflight and iNAV configurators, growing toward full Mission Planner feature
          depth. Connect a flight controller over USB, or over the network from the desktop app — or
          try it with no hardware at all:
        </p>
        <div className="la-row">
          <LaButton
            variant="secondary"
            onClick={() => void connectionService.connect({ kind: 'virtual' })}
          >
            Start demo mode
          </LaButton>
          <LaButton variant="ghost" onClick={() => setSimTrayOpen(true)}>
            Run a simulator…
          </LaButton>
        </div>
      </LaCard>
    )
  }

  return <LiveVehiclePanel />
}
