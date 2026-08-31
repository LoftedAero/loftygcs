import { useState } from 'react'
import { LaButton } from '../../components/La'
import { isDirty, useMissionStore } from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { openFromFile, readFromVehicle, saveToFile, writeToVehicle } from '../../../services/mission'

// File in, file out, vehicle in, vehicle out -- and one badge saying whether
// the screen and the aircraft agree.
//
// Write is the primary action here, and it is the only one: uploading is
// what makes a plan real, and it is also the only button that changes what
// the aircraft will do if someone switches to Auto.

export default function MissionToolbar() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const transfer = useMissionStore((s) => s.transfer)
  const dirty = useMissionStore(isDirty)
  const synced = useMissionStore((s) => s.synced)
  const items = useMissionStore((s) => s.plan.items.length)
  const sourceName = useMissionStore((s) => s.sourceName)
  const clear = useMissionStore((s) => s.clear)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch {
      // The store already carries the message; the toolbar shows it below.
    } finally {
      setBusy(false)
    }
  }

  const working = busy || transfer.kind === 'busy'

  return (
    <div className="mission-toolbar">
      <div className="mission-toolbar__group">
        <LaButton variant="secondary" size="sm" disabled={working} onClick={() => void run(openFromFile)}>
          Open…
        </LaButton>
        <LaButton
          variant="secondary"
          size="sm"
          disabled={working || items === 0}
          onClick={() => saveToFile(fileName(sourceName))}
        >
          Save
        </LaButton>
      </div>

      <div className="mission-toolbar__group">
        <LaButton
          variant="secondary"
          size="sm"
          disabled={working || !connected}
          onClick={() => void run(readFromVehicle)}
        >
          Read vehicle
        </LaButton>
        <LaButton
          variant="primary"
          size="sm"
          disabled={working || !connected || items === 0}
          onClick={() => void run(writeToVehicle)}
        >
          Write vehicle
        </LaButton>
      </div>

      <div className="mission-toolbar__group">
        <LaButton variant="ghost" size="sm" disabled={working || items === 0} onClick={clear}>
          Clear
        </LaButton>
      </div>

      <div className="mission-toolbar__status">
        {transfer.kind === 'busy' ? (
          <span className="mission-toolbar__note">
            {transfer.dir === 'read' ? 'Reading' : 'Writing'} {transfer.got}
            {transfer.total ? ` of ${transfer.total}` : ''}…
          </span>
        ) : transfer.kind === 'error' ? (
          <span className="mission-toolbar__note is-error">{transfer.text}</span>
        ) : (
          <span className="mission-toolbar__note">{transfer.kind === 'done' ? transfer.text : ''}</span>
        )}
        <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
          {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
        </span>
      </div>
    </div>
  )
}

/** A .waypoints name, reusing the loaded one where there was one. */
function fileName(source: string | null): string {
  if (!source || source === 'Vehicle') return 'mission.waypoints'
  return source.replace(/\.(plan|txt|mission)$/i, '.waypoints')
}
