import { useState } from 'react'
import { LaButton, LaHint } from '../../components/La'
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
      <div className="mission-toolbar__head">
        <h3 className="mission-settings__head">Mission</h3>
        <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
          {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
        </span>
      </div>

      {/* Vehicle before file: writing is the action that makes a plan real,
          and it is the one with a consequence, so it leads. One per row and
          full width -- the column is narrow enough that two to a row gave
          each a label with barely room for the word in it. */}
      <LaButton
        variant="secondary"
        size="block"
        disabled={working || !connected}
        onClick={() => void run(readFromVehicle)}
      >
        Read from vehicle
      </LaButton>
      <LaButton
        variant="primary"
        size="block"
        disabled={working || !connected || items === 0}
        onClick={() => void run(writeToVehicle)}
      >
        Write to vehicle
      </LaButton>
      {!connected && <LaHint>Connect a vehicle to read or write.</LaHint>}

      <LaButton
        variant="secondary"
        size="block"
        disabled={working}
        onClick={() => void run(openFromFile)}
      >
        Open from file
      </LaButton>
      <LaButton
        variant="secondary"
        size="block"
        disabled={working || items === 0}
        onClick={() => saveToFile(fileName(sourceName))}
      >
        Save to file
      </LaButton>

      <LaButton
        variant="ghost"
        size="block"
        disabled={working || items === 0}
        onClick={clear}
      >
        Clear mission
      </LaButton>

      {transfer.kind === 'busy' ? (
        <p className="mission-toolbar__note">
          {transfer.dir === 'read' ? 'Reading' : 'Writing'} {transfer.got}
          {transfer.total ? ` of ${transfer.total}` : ''}…
        </p>
      ) : transfer.kind === 'error' ? (
        <p className="mission-toolbar__note is-error">{transfer.text}</p>
      ) : transfer.kind === 'done' ? (
        <p className="mission-toolbar__note">{transfer.text}</p>
      ) : null}
    </div>
  )
}

/** A .waypoints name, reusing the loaded one where there was one. */
function fileName(source: string | null): string {
  if (!source || source === 'Vehicle') return 'mission.waypoints'
  return source.replace(/\.(plan|txt|mission)$/i, '.waypoints')
}
