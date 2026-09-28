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

// Read, write and clear for whichever of the three plans is being edited.
// One shared component so the plans behave identically; what differs between
// them (the noun, the modified selector, what counts as empty) is data.

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

  // Hooks cannot be conditional, so every plan's state is read and the
  // edited one picked afterward.
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
  // The vehicle rejects a bad fence without saying why, so it is validated
  // here, naming the offending shape.
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
 * Asks whether to clear the screen or the vehicle. Neither is a safe default:
 * clearing only the screen leaves a fence the vehicle still enforces, and
 * clearing the vehicle may discard the only copy of a plan.
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
      {!connected && <p>Not connected, so only this screen can be cleared.</p>}
    </LaModal>
  )
}
