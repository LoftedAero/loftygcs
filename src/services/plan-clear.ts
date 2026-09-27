// Emptying a plan on the screen, and optionally on the vehicle.
//
// These are different actions: a fence cleared on screen is still enforced
// by the vehicle, and a mission cleared on screen is still what Auto will
// fly. An empty plan cannot show which happened, so the user is asked when
// they clear.
//
// Shared by all three plans, which differ only by mission_type.

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
 * Uses MISSION_CLEAR_ALL rather than an empty upload: it is the documented
 * message for this, and one round trip.
 *
 * The screen is emptied and marked synced only once the vehicle acks. A
 * refused clear leaves the plan alone, since the vehicle still holds it.
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
