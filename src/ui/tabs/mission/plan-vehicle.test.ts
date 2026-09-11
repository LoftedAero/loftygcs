import { beforeEach, describe, expect, it } from 'vitest'
import { commandsFor, MISSION_COMMANDS } from '../../../protocol/mission-commands'
import { usePreferencesStore } from '../../../stores/preferences-store'

// A plan is written for an aircraft, and the command set is not the same for
// all of them. ArduPlane refuses NAV_SPLINE_WAYPOINT and NAV_PAYLOAD_PLACE on
// upload, so offering them to a plane is a menu entry that can only ever
// fail -- which is the open issue Mission Planner has for exactly this.

describe('the commands offered for a vehicle', () => {
  it('drops the Copter-only ones for a plane and a rover', () => {
    const planeIds = commandsFor('plane').map((c) => c.id)
    expect(planeIds).not.toContain(82) // NAV_SPLINE_WAYPOINT
    expect(planeIds).not.toContain(94) // NAV_PAYLOAD_PLACE
    expect(commandsFor('rover').map((c) => c.id)).not.toContain(82)
    // Everything else survives: this filters, it does not curate.
    expect(planeIds).toContain(16) // NAV_WAYPOINT
    expect(planeIds.length).toBe(MISSION_COMMANDS.length - 2)
  })

  it('gives a copter the whole catalog', () => {
    expect(commandsFor('copter').length).toBe(MISSION_COMMANDS.length)
  })

  it('gives an unrecognized vehicle the whole catalog', () => {
    // Unknown is not the same as absent. A vehicle that has not said what it
    // is gets everything rather than having commands hidden on a guess --
    // the same rule the MAVFTP capability bit taught, and the one Betaflight
    // states outright about its own build options.
    expect(commandsFor('other').length).toBe(MISSION_COMMANDS.length)
  })

  it('is the same list the SITL upload test checks', () => {
    // The set used to live in that test as bare ids, so the app and the test
    // could disagree. Both read this field now.
    const flagged = MISSION_COMMANDS.filter((c) => c.copterOnly).map((c) => c.id)
    expect(flagged.sort()).toEqual([82, 94])
  })
})

describe('what to plan for with nothing connected', () => {
  beforeEach(() => usePreferencesStore.getState().reset())

  it('defaults to the vehicle with the widest command set', () => {
    // A wrong default then costs an unused menu entry rather than a missing
    // one, and Copter is the commonest ArduPilot vehicle.
    expect(usePreferencesStore.getState().planFor).toBe('copter')
  })

  it('remembers the choice', () => {
    usePreferencesStore.getState().setPlanFor('plane')
    expect(usePreferencesStore.getState().planFor).toBe('plane')
  })
})
