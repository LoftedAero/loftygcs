import { LaCard } from '../../components/La'

// Log download and review. The dataflash parser and plotting work is a
// later phase; until then this tab is honest about what it cannot do yet
// and points at the tools that can.
export default function LogsTab() {
  return (
    <LaCard title="Logs" note="Downloading and plotting arrive in a later release.">
      <p className="app-placeholder">
        This will download dataflash logs from the vehicle over MAVFTP and plot them here —
        altitude, attitude, vibration, power, and the message stream — without uploading anything
        anywhere.
      </p>
      <p className="app-placeholder">
        In the meantime, ArduPilot&apos;s browser tools read a log straight off your disk and stay
        entirely client-side: the UAV Log Viewer for general review, MAGFit for compass fits, and
        Filter Review for vibration and notch tuning.
      </p>
      <div className="la-row">
        <button
          className="la-link-btn"
          onClick={() => {
            const url = 'https://firmware.ardupilot.org/Tools/WebTools/'
            if (window.loftgcs) window.loftgcs.app.openExternal(url)
            else window.open(url, '_blank', 'noopener')
          }}
        >
          Open ArduPilot web tools
        </button>
      </div>
    </LaCard>
  )
}
