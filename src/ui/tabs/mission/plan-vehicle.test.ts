import { beforeEach, describe, expect, it } from 'vitest'
import { commandsFor, MISSION_COMMANDS } from '../../../protocol/mission-commands'
import { usePreferencesStore } from '../../../stores/preferences-store'

// The command set differs by aircraft: ArduPlane refuses NAV_SPLINE_WAYPOINT
// and NAV_PAYLOAD_PLACE on upload.

describe('the commands offered for a vehicle', () => {
  it('drops the Copter-only ones for a plane and a rover', () => {
    const planeIds = commandsFor('plane').map((c) => c.id)
    expect(planeIds).not.toContain(82) // NAV_SPLINE_WAYPOINT
    expect(planeIds).not.toContain(94) // NAV_PAYLOAD_PLACE
    expect(commandsFor('rover').map((c) => c.id)).not.toContain(82)
    // Everything else survives.
    expect(planeIds).toContain(16) // NAV_WAYPOINT
    expect(planeIds.length).toBe(MISSION_COMMANDS.length - 2)
  })

  it('gives a copter the whole catalog', () => {
    expect(commandsFor('copter').length).toBe(MISSION_COMMANDS.length)
  })

  it('gives an unrecognized vehicle the whole catalog', () => {
    // Unknown is not absent: an unrecognized vehicle gets every command
    // rather than having some hidden on a guess.
    expect(commandsFor('other').length).toBe(MISSION_COMMANDS.length)
  })

  it('is the same list the SITL upload test checks', () => {
    // The app and that test both read this field, so they cannot disagree.
    const flagged = MISSION_COMMANDS.filter((c) => c.copterOnly).map((c) => c.id)
    expect(flagged.sort()).toEqual([82, 94])
  })
})

describe('what to plan for with nothing connected', () => {
  beforeEach(() => usePreferencesStore.getState().reset())

  it('defaults to the vehicle with the widest command set', () => {
    // Copter is the most common ArduPilot vehicle, and a wrong default only
    // adds unused menu entries.
    expect(usePreferencesStore.getState().planFor).toBe('copter')
  })

  it('remembers the choice', () => {
    usePreferencesStore.getState().setPlanFor('plane')
    expect(usePreferencesStore.getState().planFor).toBe('plane')
  })
})
