import { LaCard, LaHint } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import OsdLayoutEditor from './OsdLayoutEditor'

// On-screen display: the OSD's own settings and warning thresholds, then the
// screen layout editor.
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
      {/* The layout comes first: it is what the tab is for, and burying the
          screen preview under two cards of settings put it below the fold on
          a 1080p window. */}
      <OsdLayoutEditor />
      <ParamCard
        title="Display"
        fields={[
          { param: 'OSD_TYPE', label: 'OSD type' },
          { param: 'OSD_UNITS', label: 'Units' },
          { param: 'OSD_MSG_TIME', label: 'Message time', unit: 's' },
          { param: 'OSD_SW_METHOD', label: 'Screen switch method' },
          { param: 'OSD_OPTIONS', label: 'Options' },
        ]}
      >
        {entries.get('OSD_TYPE')?.value === 0 && (
          <LaHint>
            The OSD is off, so nothing is drawn on the video feed. Screens can still be laid out,
            and take effect once a type is set — which needs a reboot.
          </LaHint>
        )}
      </ParamCard>
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
    </>
  )
}
