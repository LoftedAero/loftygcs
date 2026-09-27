import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMissionStore } from '../stores/mission-store'

// What the vehicle was asked to forget, and whether it agreed.
const cleared: number[] = []
let refuse: string | null = null

vi.mock('./connection', () => ({
  connectionService: {
    clearMission: (missionType: number) => {
      cleared.push(missionType)
      return refuse ? Promise.reject(new Error(refuse)) : Promise.resolve()
    },
  },
}))

const { clearPlanHere, clearPlanOnVehicle } = await import('./plan-clear')

const HOME = { x: 399500000, y: -1052500000, z: 1900 }
const POINT = { x: 399510000, y: -1052510000 }

beforeEach(() => {
  cleared.length = 0
  refuse = null
  const store = useMissionStore.getState()
  store.clear()
  store.setHome({ ...HOME })
  store.addItem(16, POINT)
  store.setFence({ shapes: [], returnPoint: null })
  store.setFenceReturn(POINT)
  store.setRally([])
  useMissionStore.getState().addRally(POINT)
})

describe('clearing on this screen only', () => {
  it('empties the plan and leaves the vehicle alone', () => {
    clearPlanHere('mission')
    expect(useMissionStore.getState().plan.items).toHaveLength(0)
    clearPlanHere('fence')
    expect(useMissionStore.getState().fence.returnPoint).toBeNull()
    clearPlanHere('rally')
    expect(useMissionStore.getState().rally).toHaveLength(0)
    expect(cleared).toEqual([])
  })

  it('leaves the badge saying the vehicle still has one', () => {
    // An empty screen and an empty vehicle look identical; only the badge
    // tells them apart.
    useMissionStore.getState().markSynced()
    clearPlanHere('mission')
    const s = useMissionStore.getState()
    expect(s.synced?.items.length).toBe(1)
  })
})

describe('clearing on the vehicle too', () => {
  it('sends MISSION_CLEAR_ALL for the right mission_type', async () => {
    await clearPlanOnVehicle('mission')
    await clearPlanOnVehicle('fence')
    await clearPlanOnVehicle('rally')
    expect(cleared).toEqual([0, 1, 2])
  })

  it('empties the screen and calls both ends matched', async () => {
    await clearPlanOnVehicle('fence')
    const s = useMissionStore.getState()
    expect(s.fence.shapes).toHaveLength(0)
    expect(s.fence.returnPoint).toBeNull()
    // Both ends are empty, which is what "matches vehicle" means.
    expect(s.fenceSynced).not.toBeNull()
  })

  it('keeps the plan when the vehicle refuses', async () => {
    // Emptying the screen anyway would show a vehicle with no mission while
    // it still holds one.
    refuse = 'Mission transfer refused: MAV_MISSION_ERROR'
    await expect(clearPlanOnVehicle('mission')).rejects.toThrow(/refused/)
    const s = useMissionStore.getState()
    expect(s.plan.items).toHaveLength(1)
    expect(s.transfer).toMatchObject({ kind: 'error' })
  })
})
