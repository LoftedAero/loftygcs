import { describe, expect, it } from 'vitest'
import { formatEta, missionProgress } from './mission-progress'
import type { PlanItem } from '../../../protocol/mission-plan'

/** A plan of N items: home, then waypoints. */
function plan(commands: number[]): PlanItem[] {
  return commands.map((command, i) => ({
    uid: `u${i}`,
    frame: 3,
    command,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: 515000000 + i * 1000,
    y: -1200000,
    z: 50,
  }))
}

// 16 NAV_WAYPOINT, 22 NAV_TAKEOFF, 21 NAV_LAND.
const ITEMS = plan([16, 22, 16, 16, 21])

describe('what to say about progress', () => {
  it('names the item and the command being flown', () => {
    const p = missionProgress(2, ITEMS, 100, 10)
    expect(p.position).toBe('2 of 4')
    expect(p.commandName).toBe('Waypoint')
  })

  it('says nothing at all before the vehicle reports an item', () => {
    expect(missionProgress(null, ITEMS, 100, 10)).toEqual({
      position: null,
      commandName: null,
      etaS: null,
    })
  })

  it('says nothing for item 0, which is home and what a vehicle with no mission reports', () => {
    expect(missionProgress(0, [], 0, 0).position).toBeNull()
  })

  it('still reports the sequence when the plan here is not the one aboard', () => {
    // A mission uploaded elsewhere, or none loaded here: only the name
    // needs a local plan.
    const p = missionProgress(7, ITEMS, 100, 10)
    expect(p.position).toBe('7 of 4')
    expect(p.commandName).toBeNull()
    // And with no plan at all, rather than indexing past the end of one.
    const none = missionProgress(3, [], 100, 10)
    expect(none.position).toBe('3')
    expect(none.commandName).toBeNull()
  })

  it('computes an ETA from distance and groundspeed', () => {
    expect(missionProgress(2, ITEMS, 100, 10).etaS).toBeCloseTo(10, 6)
  })

  it('refuses an ETA when the vehicle is not going anywhere', () => {
    // A groundspeed of zero would give Infinity.
    expect(missionProgress(2, ITEMS, 100, 0).etaS).toBeNull()
    expect(missionProgress(2, ITEMS, 100, 0.2).etaS).toBeNull()
  })

  it('refuses an ETA the vehicle has not given a distance for', () => {
    // NAV_CONTROLLER_OUTPUT only streams in a navigation mode; in Loiter
    // there is no target and no distance to one.
    expect(missionProgress(2, ITEMS, null, 12).etaS).toBeNull()
  })

  it('drops an ETA past an hour rather than showing 91:20', () => {
    expect(missionProgress(2, ITEMS, 100000, 10).etaS).toBeNull()
    expect(missionProgress(2, ITEMS, 35000, 10).etaS).toBeCloseTo(3500, 6)
  })
})

describe('formatEta', () => {
  it('reads as a clock', () => {
    expect(formatEta(45)).toBe('0:45')
    expect(formatEta(200)).toBe('3:20')
    expect(formatEta(0)).toBe('0:00')
    // Seconds pad, so the column does not jump between 3:5 and 3:15.
    expect(formatEta(185)).toBe('3:05')
  })
})
