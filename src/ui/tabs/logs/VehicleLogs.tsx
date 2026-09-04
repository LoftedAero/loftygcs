import { useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useLogStore } from '../../../stores/log-store'
import { downloadVehicleLog, listVehicleLogs } from '../../../services/log-download'

// The logs on the vehicle's card: list them, pick one, watch it come across.
//
// Size is shown next to every entry because it is the only thing that tells
// you what you are about to wait for. The same ten-megabyte log is a minute
// over USB and the better part of an hour over a 57600-baud radio, and a
// pilot deciding which log to pull deserves to know that before starting.

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

      <LaButton
        variant="secondary"
        size="block"
        disabled={working || !connected}
        onClick={() => void run(listVehicleLogs)}
      >
        {status.kind === 'listing' ? 'Listing…' : logs.length ? 'Refresh list' : 'List logs'}
      </LaButton>
      {!connected && <LaHint>Connect a vehicle to read its logs.</LaHint>}

      {status.kind === 'downloading' && (
        <>
          <p className="app-col__note">
            {status.name} — {formatSize(status.got)}
            {status.total > 0 && ` of ${formatSize(status.total)}`}
          </p>
          <progress
            className="log-progress"
            value={status.got}
            max={Math.max(1, status.total)}
            aria-label={`Downloading ${status.name}`}
          />
        </>
      )}
      {status.kind === 'error' && <LaHint error>{status.text}</LaHint>}

      {logs.length > 0 && (
        <div className="log-list">
          {logs.map((l) => (
            <button
              key={l.path}
              type="button"
              className="log-list__item"
              disabled={working}
              onClick={() => void run(() => downloadVehicleLog(l))}
            >
              <span className="log-list__name">{l.name}</span>
              <span className="log-list__size">{formatSize(l.size)}</span>
            </button>
          ))}
        </div>
      )}
      {logs.length > 0 && (
        <LaHint>
          Newest first. Downloading opens the log here; it is not saved to disk unless you save
          it.
        </LaHint>
      )}
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`
  return `${bytes} B`
}
