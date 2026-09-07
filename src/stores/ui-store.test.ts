import { describe, expect, it } from 'vitest'
import { MODES, useUiStore } from './ui-store'

// The mode switch's shape, in its own file so the store is read before any
// other test has moved it -- App.test.tsx sets a mode in beforeEach, which
// would make an assertion about the default there pass for the wrong reason.

describe('where the app opens', () => {
  it('opens on Fly', () => {
    // The flight screen draws with or without a vehicle, so opening on it
    // costs nothing when nothing is connected and saves a click when
    // something is.
    expect(useUiStore.getState().mode).toBe('fly')
  })

  it('puts Fly first and Setup last', () => {
    // Mission Planner's order, and the order the work happens in: flying is
    // what the app is for, setup is where you go when the aircraft needs
    // changing.
    expect(MODES.map((m) => m.id)).toEqual(['fly', 'mission', 'setup'])
  })
})
