// Reading and writing fences and rally points.
//
// Same transfer protocol and client as the mission, keyed by mission_type.
// The fence is validated before upload because the vehicle rejects a bad one
// with a single MAV_MISSION_ERROR that does not say which shape was wrong.
// Clearing the vehicle is MISSION_CLEAR_ALL, in `plan-clear.ts`.

import { connectionService } from './connection'
import { useMissionStore } from '../stores/mission-store'
import {
  fenceFromItems,
  fenceToItems,
  rallyFromItems,
  rallyToItems,
  validateFence,
} from '../protocol/geofence'

const FENCE = 1
const RALLY = 2

export async function readFence(): Promise<void> {
  const store = useMissionStore.getState()
  store.setTransfer({ kind: 'busy', dir: 'read', got: 0, total: 0 })
  try {
    const items = await connectionService.downloadMission(FENCE)
    const { plan, problems } = fenceFromItems(items)
    store.setFence(plan, { synced: true })
    store.setTransfer({
      kind: problems.length ? 'error' : 'done',
      text: problems.length
        ? problems.join(' ')
        : plan.shapes.length
          ? `Read ${plan.shapes.length} fence ${plan.shapes.length === 1 ? 'shape' : 'shapes'}`
          : 'Vehicle has no fence',
    })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

export async function writeFence(): Promise<void> {
  const store = useMissionStore.getState()
  const fence = store.fence
  const problems = validateFence(fence)
  if (problems.length) {
    store.setTransfer({ kind: 'error', text: problems.join(' ') })
    throw new Error(problems[0])
  }
  const items = fenceToItems(fence)
  store.setTransfer({ kind: 'busy', dir: 'write', got: 0, total: items.length })
  try {
    await connectionService.uploadMission(items, FENCE)
    useMissionStore.getState().setFence(fence, { synced: true })
    store.setTransfer({
      kind: 'done',
      text: items.length
        ? `Wrote ${fence.shapes.length} ${fence.shapes.length === 1 ? 'shape' : 'shapes'}`
        : 'Cleared the fence',
    })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

export async function readRally(): Promise<void> {
  const store = useMissionStore.getState()
  store.setTransfer({ kind: 'busy', dir: 'read', got: 0, total: 0 })
  try {
    const points = rallyFromItems(await connectionService.downloadMission(RALLY))
    store.setRally(points, { synced: true })
    store.setTransfer({
      kind: 'done',
      text: points.length
        ? `Read ${points.length} rally ${points.length === 1 ? 'point' : 'points'}`
        : 'Vehicle has no rally points',
    })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

export async function writeRally(): Promise<void> {
  const store = useMissionStore.getState()
  const points = store.rally
  store.setTransfer({ kind: 'busy', dir: 'write', got: 0, total: points.length })
  try {
    await connectionService.uploadMission(rallyToItems(points), RALLY)
    useMissionStore.getState().setRally(points, { synced: true })
    store.setTransfer({
      kind: 'done',
      text: points.length
        ? `Wrote ${points.length} rally ${points.length === 1 ? 'point' : 'points'}`
        : 'Cleared the rally points',
    })
  } catch (err) {
    store.setTransfer({ kind: 'error', text: message(err) })
    throw err
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
