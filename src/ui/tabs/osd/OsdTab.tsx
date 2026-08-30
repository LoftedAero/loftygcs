import { LaCard } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'

// On-screen display settings. The panel-placement editor (dragging elements
// onto a screen preview) is a later phase; what is here configures the OSD
// itself and its warning thresholds.
export default function OsdTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)
  if (!connected) {
    return (
      <NeedsVehicle
        title="OSD"
        body="On-screen display type, units, and warning thresholds."
      />
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
  return (
    <>
      <ParamCard
        title="Display"
        fields={[
          { param: 'OSD_TYPE', label: 'OSD type' },
          { param: 'OSD_UNITS', label: 'Units' },
          { param: 'OSD_MSG_TIME', label: 'Message time', unit: 's' },
          { param: 'OSD_SW_METHOD', label: 'Screen switch method' },
          { param: 'OSD_OPTIONS', label: 'Options' },
        ]}
      />
      <ParamCard
        title="Warnings"
        note="These drive the OSD's own warning highlights, separately from the vehicle's failsafes."
        fields={[
          { param: 'OSD_W_BATVOLT', label: 'Battery voltage', unit: 'V' },
          { param: 'OSD_W_RSSI', label: 'RSSI' },
          { param: 'OSD_W_NSAT', label: 'Satellite count' },
          { param: 'OSD_W_TERR', label: 'Terrain altitude', unit: 'm' },
          { param: 'OSD_W_AVGCELLV', label: 'Average cell voltage', unit: 'V' },
        ]}
      />
      <LaCard title="Screen layout" note="Panel placement arrives in a later release.">
        <p className="app-placeholder">
          Element positions are set today through the OSD1_* parameters on the Parameters tab; a
          drag-and-drop screen editor is planned.
        </p>
      </LaCard>
    </>
  )
}
