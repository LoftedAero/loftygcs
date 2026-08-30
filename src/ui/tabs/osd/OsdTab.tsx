import { LaCard } from '../../components/La'
import { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import OsdWorkspace from './OsdWorkspace'

// On-screen display. The tab is one three-column workspace rather than a
// stack of cards, so everything is reachable without scrolling; see
// OsdWorkspace.
export default function OsdTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)
  if (!connected) {
    return (
      <NeedsVehicle title="OSD" body="On-screen display type, units, and warning thresholds." />
    )
  }
  if (!entries.has('OSD_TYPE')) {
    return (
      <LaCard title="OSD" note="This firmware build has no OSD support compiled in.">
        <p className="app-placeholder">
          Boards without an onboard OSD chip need a build that includes MSP DisplayPort or an
          analog OSD before these settings appear.
        </p>
      </LaCard>
    )
  }
  return <OsdWorkspace />
}
