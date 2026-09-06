// Emptying a plan -- on the screen, and optionally on the aircraft.
//
// The two are genuinely different actions and the difference matters: a
// fence cleared on screen is still being enforced by the vehicle, and a
// mission cleared on screen is still what Auto will fly. The screen has no
// way to show that gap once the plan is empty, because an empty plan and a
// plan that was never read look identical -- so the choice is put to the
// user at the moment they clear, rather than left as a hint they have to
// notice afterwards.
//
// One file for all three plans, because they differ only by mission_type
// and three copies of this would drift the way the columns did.

import { connectionService } from './connection'
import { useMissionStore, type PlanKind } from '../stores/mission-store'

/** MAVLink's mission_type, which is the only thing separating the three. */
export const PLAN_TYPE: Record<PlanKind, number> = { mission: 0, fence: 1, rally: 2 }

/** What the button says, and what the aircraft is asked to forget. */
export const PLAN_NOUN: Record<PlanKind, string> = {
  mission: 'mission',
  fence: 'fence',
  rally: 'rally points',
}

/** Empty the plan on screen, leaving whatever the vehicle holds alone. */
export function clearPlanHere(kind: PlanKind): void {
  const store = useMissionStore.getState()
  if (kind === 'mission') store.clear()
  else if (kind === 'fence') store.setFence({ shapes: [], returnPoint: null })
  else store.setRally([])
}

/**
 * Empty it on the vehicle as well.
 *
 * MISSION_CLEAR_ALL rather than an upload of no items: it is the message the
 * protocol defines for exactly this, and it is one round trip rather than a
 * count-and-ack handshake over nothing. An empty upload does clear all three
 * on 4.6 SITL -- sitl.integration.test.ts asserts it -- but that is one
 * firmware's behavior where this is every version's documented one.
 *
 * The screen is only emptied once the vehicle has acked, and it is then
 * marked synced -- both ends are empty, which is exactly what "matches
 * vehicle" means. A refused clear leaves the plan alone, or the screen would
 * report a vehicle with nothing on it while it still holds the old one.
 */
export async function clearPlanOnVehicle(kind: PlanKind): Promise<void> {
  const store = useMissionStore.getState()
  store.setTransfer({ kind: 'busy', dir: 'write', got: 0, total: 0 })
  try {
    await connectionService.clearMission(PLAN_TYPE[kind])
    const after = useMissionStore.getState()
    if (kind === 'mission') {
      after.clear()
      useMissionStore.getState().markSynced()
    } else if (kind === 'fence') {
      after.setFence({ shapes: [], returnPoint: null }, { synced: true })
    } else {
      after.setRally([], { synced: true })
    }
    useMissionStore
      .getState()
      .setTransfer({ kind: 'done', text: `Cleared the ${PLAN_NOUN[kind]} on the vehicle` })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
