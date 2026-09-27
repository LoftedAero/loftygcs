import { describe, expect, it } from 'vitest'
import { MODES, useUiStore } from './ui-store'

// In its own file so the store's default is read before any other test
// changes it (App.test.tsx sets a mode in beforeEach).

describe('where the app opens', () => {
  it('opens on Fly', () => {
    // The flight screen works with or without a vehicle.
    expect(useUiStore.getState().mode).toBe('fly')
  })

  it('puts Fly first and Setup last', () => {
    // Mission Planner's order.
    expect(MODES.map((m) => m.id)).toEqual(['fly', 'mission', 'setup'])
  })
})
