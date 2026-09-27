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
      <NeedsVehicle title="OSD" />
    )
  }
  if (!entries.has('OSD_TYPE')) {
    return (
      // OSD parameters exist only in builds with MSP DisplayPort or an
      // analog OSD compiled in.
      <LaCard title="OSD" note="This firmware build has no OSD support compiled in." />
    )
  }
  return <OsdWorkspace />
}
