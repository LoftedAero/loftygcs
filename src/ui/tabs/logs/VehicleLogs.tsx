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

      {/* During a download this button is its Cancel: the list cannot be
          refreshed mid-transfer anyway, and a Cancel of its own would add a
          row to the column for as long as the download ran. */}
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

      {/* A download shows in its own row -- filling from the left, its size
          turned into how far it has got -- rather than on a line of its own
          above the list, which pushed every row down 37px for as long as the
          transfer ran and read "— — of 553 kB" before the first bytes. */}
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
      {/* Under the list, not above it: a line that comes and goes goes last,
          where nothing below it can be moved. */}
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
