import { useState, type CSSProperties } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useLogStore } from '../../../stores/log-store'
import {
  cancelVehicleLogDownload,
  downloadVehicleLog,
  listVehicleLogs,
} from '../../../services/log-download'

// The logs on the vehicle's card: list them, pick one, watch it come across.
//
// Size is shown next to every entry because download time depends on it: a
// ten-megabyte log is a minute over USB and most of an hour over a
// 57600-baud radio.

export default function VehicleLogs() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const logs = useLogStore((s) => s.vehicleLogs)
  const status = useLogStore((s) => s.vehicleStatus)
  const [busy, setBusy] = useState(false)

  const working = busy || status.kind === 'listing' || status.kind === 'downloading'

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="app-col__group">
      <h3 className="app-col__head">On the vehicle</h3>

      {/* During a download this button becomes Cancel. */}
      {status.kind === 'downloading' ? (
        <LaButton variant="ghost" size="block" onClick={cancelVehicleLogDownload}>
          Cancel download
        </LaButton>
      ) : (
        <LaButton
          variant="secondary"
          size="block"
          disabled={working || !connected}
          onClick={() => void run(listVehicleLogs)}
        >
          {status.kind === 'listing' ? 'Listing…' : logs.length ? 'Refresh list' : 'List logs'}
        </LaButton>
      )}
      {!connected && <LaHint>Connect a vehicle to read its logs.</LaHint>}

      {/* A download shows progress in its own row, so the list does not shift. */}
      {logs.length > 0 && (
        <div className="log-list">
          {logs.map((l) => {
            const pct =
              status.kind === 'downloading' && status.name === l.name
                ? Math.floor((100 * status.got) / Math.max(1, status.total || l.size))
                : null
            return (
              <button
                key={l.path}
                type="button"
                className={`log-list__item${pct !== null ? ' is-downloading' : ''}`}
                style={pct !== null ? ({ '--pct': `${pct}%` } as CSSProperties) : undefined}
                disabled={working}
                aria-label={pct !== null ? `Downloading ${l.name}, ${pct}%` : undefined}
                onClick={() => void run(() => downloadVehicleLog(l))}
              >
                <span className="log-list__name">{l.name}</span>
                <span className="log-list__size">
                  {pct !== null ? `${pct}%` : formatSize(l.size)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {/* Last, so it moves nothing when it appears. */}
      {status.kind === 'error' && <LaHint error>{status.text}</LaHint>}
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`
  return `${bytes} B`
}
