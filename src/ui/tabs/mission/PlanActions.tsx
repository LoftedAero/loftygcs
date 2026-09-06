import { useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import {
  fenceDirty,
  isDirty,
  rallyDirty,
  useMissionStore,
  type PlanKind,
} from '../../../stores/mission-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { readFromVehicle, writeToVehicle } from '../../../services/mission'
import { readFence, readRally, writeFence, writeRally } from '../../../services/geofence'
import { clearPlanHere, clearPlanOnVehicle, PLAN_NOUN } from '../../../services/plan-clear'
import { validateFence } from '../../../protocol/geofence'

// Read, write, clear -- for whichever of the three plans is being edited.
//
// One component rather than a copy in each panel. The three had grown their
// own: the mission put Clear below the file buttons and the other two put it
// straight under Write, one reported a failed transfer in a hint and another
// in a note, and only the mission showed progress while a transfer ran. None
// of that was a decision, and the actions column exists to stop exactly this
// kind of drift (see CLAUDE.md). What differs between the plans is data --
// the noun, which selector says it is modified, and what counts as empty.

const PLANS: Record<
  PlanKind,
  { title: string; read: () => Promise<void>; write: () => Promise<void> }
> = {
  mission: { title: 'Mission', read: readFromVehicle, write: writeToVehicle },
  fence: { title: 'Fence', read: readFence, write: writeFence },
  rally: { title: 'Rally', read: readRally, write: writeRally },
}

export default function PlanActions() {
  const editing = useMissionStore((s) => s.editing)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const transfer = useMissionStore((s) => s.transfer)

  // Every plan's state is read unconditionally -- hooks cannot be chosen by
  // which one is on screen -- and the one being edited is picked afterwards.
  const missionDirty = useMissionStore(isDirty)
  const fenceIsDirty = useMissionStore(fenceDirty)
  const rallyIsDirty = useMissionStore(rallyDirty)
  const missionSynced = useMissionStore((s) => s.synced !== null)
  const fenceSynced = useMissionStore((s) => s.fenceSynced !== null)
  const rallySynced = useMissionStore((s) => s.rallySynced !== null)
  const items = useMissionStore((s) => s.plan.items.length)
  const fence = useMissionStore((s) => s.fence)
  const rally = useMissionStore((s) => s.rally.length)

  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  const dirty =
    editing === 'mission' ? missionDirty : editing === 'fence' ? fenceIsDirty : rallyIsDirty
  const synced =
    editing === 'mission' ? missionSynced : editing === 'fence' ? fenceSynced : rallySynced
  const empty =
    editing === 'mission'
      ? items === 0
      : editing === 'fence'
        ? fence.shapes.length === 0 && !fence.returnPoint
        : rally === 0
  // Only a fence can be internally wrong, and the vehicle's rejection names
  // nothing -- so it is caught here rather than sent. The shape it names is
  // listed in the panel below.
  const problems = editing === 'fence' ? validateFence(fence) : []

  const working = busy || transfer.kind === 'busy'
  const plan = PLANS[editing]

  const run = (fn: () => Promise<void>) => {
    setBusy(true)
    // The store carries the message either way; the note below shows it.
    void fn()
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  return (
    <section className="app-col__group">
      <div className="app-col__headrow">
        <h3 className="app-col__head">{plan.title}</h3>
        <span className={`mission-badge${dirty ? ' is-dirty' : synced ? ' is-synced' : ''}`}>
          {!synced ? 'Not on vehicle' : dirty ? 'Modified' : 'Matches vehicle'}
        </span>
      </div>

      <LaButton
        variant="secondary"
        size="block"
        disabled={working || !connected}
        onClick={() => run(plan.read)}
      >
        Read from vehicle
      </LaButton>
      <LaButton
        variant="primary"
        size="block"
        disabled={working || !connected || empty || problems.length > 0}
        onClick={() => run(plan.write)}
      >
        Write to vehicle
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={working || (empty && !connected)}
        onClick={() => setAsking(true)}
      >
        Clear {PLAN_NOUN[editing]}
      </LaButton>

      {!connected && <LaHint>Connect a vehicle to read or write.</LaHint>}

      {transfer.kind === 'busy' ? (
        <p className="app-col__note">
          {transfer.dir === 'read' ? 'Reading' : 'Writing'} {transfer.got}
          {transfer.total ? ` of ${transfer.total}` : ''}…
        </p>
      ) : transfer.kind === 'error' ? (
        <p className="app-col__note is-error">{transfer.text}</p>
      ) : transfer.kind === 'done' ? (
        <p className="app-col__note">{transfer.text}</p>
      ) : null}

      <ClearPrompt
        open={asking}
        kind={editing}
        connected={connected}
        onClose={() => setAsking(false)}
        onHere={() => {
          clearPlanHere(editing)
          setAsking(false)
        }}
        onVehicle={() => {
          setAsking(false)
          run(() => clearPlanOnVehicle(editing))
        }}
      />
    </section>
  )
}

/**
 * Clearing the screen and clearing the aircraft are different things.
 *
 * Neither is the safe default. Emptying only the screen leaves a fence the
 * vehicle still enforces and a mission Auto will still fly; emptying the
 * vehicle throws away a plan that may be the only copy of it. So both are
 * offered by name, and the one that reaches the aircraft is marked as the
 * destructive one it is.
 */
function ClearPrompt({
  open,
  kind,
  connected,
  onClose,
  onHere,
  onVehicle,
}: {
  open: boolean
  kind: PlanKind
  connected: boolean
  onClose: () => void
  onHere: () => void
  onVehicle: () => void
}) {
  return (
    <LaModal
      open={open}
      narrow
      title={`Clear the ${PLAN_NOUN[kind]}?`}
      actions={
        <div className="la-prompt-actions">
          <LaButton variant="secondary" size="block" onClick={onHere}>
            Clear on this screen
          </LaButton>
          <LaButton variant="danger" size="block" disabled={!connected} onClick={onVehicle}>
            Clear here and on the vehicle
          </LaButton>
          <LaButton variant="ghost" size="block" onClick={onClose}>
            Cancel
          </LaButton>
        </div>
      }
    >
      <p>
        {connected
          ? 'Clearing here does not change what the vehicle holds.'
          : 'Not connected, so only this screen can be cleared.'}
      </p>
    </LaModal>
  )
}
