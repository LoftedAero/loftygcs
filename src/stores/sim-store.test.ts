import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentHomeText, homeSlot } from './sim-store'

// Home is remembered per physics: a location measured against RealFlight's
// scenery means nothing to SITL's own model.
//
// The reads below re-import the module rather than calling a setter, because
// storage is only read at module load.

const HOME_KEY = 'loftgcs.sim.home'
const RIG_KEY = 'loftgcs.sim.rig'

const freshStore = async () => {
  vi.resetModules()
  const mod = await import('./sim-store')
  return mod.useSimStore.getState()
}

beforeEach(() => localStorage.clear())

describe('which slot a physics choice uses', () => {
  it('separates RealFlight from everything else', () => {
    expect(homeSlot('flightaxis')).toBe('flightaxis')
    expect(homeSlot('builtin')).toBe('builtin')
    // An unknown kind is not RealFlight.
    expect(homeSlot('something-new')).toBe('builtin')
  })

  it('reads the home for whatever is selected', () => {
    const homes = { builtin: '51.5,-0.1', flightaxis: '40.05,-88.55' }
    expect(currentHomeText({ homes, physics: { kind: 'builtin' } })).toBe('51.5,-0.1')
    expect(currentHomeText({ homes, physics: { kind: 'flightaxis' } })).toBe('40.05,-88.55')
  })
})

describe('reading homes stored by an older build', () => {
  // Older builds stored one bare string. The rig records which physics was
  // selected, which decides the slot it migrates into.
  it('puts a RealFlight user’s home in the RealFlight slot', async () => {
    localStorage.setItem(HOME_KEY, '40.059422,-88.551405,206,43')
    localStorage.setItem(
      RIG_KEY,
      JSON.stringify({ build: null, physics: { kind: 'flightaxis' }, params: { kind: 'wipe' } }),
    )
    const s = await freshStore()
    expect(s.homes).toEqual({ builtin: '', flightaxis: '40.059422,-88.551405,206,43' })
  })

  it('puts everyone else’s in the built-in slot', async () => {
    localStorage.setItem(HOME_KEY, '51.5,-0.1,25,90')
    const s = await freshStore()
    expect(s.homes).toEqual({ builtin: '51.5,-0.1,25,90', flightaxis: '' })
  })

  it('reads back what this build writes', async () => {
    localStorage.setItem(HOME_KEY, JSON.stringify({ builtin: 'a', flightaxis: 'b' }))
    const s = await freshStore()
    expect(s.homes).toEqual({ builtin: 'a', flightaxis: 'b' })
  })

  it('starts empty on anything it cannot read', async () => {
    // Unparseable storage leaves both slots empty, meaning both defaults.
    localStorage.setItem(HOME_KEY, '{not json')
    const s = await freshStore()
    expect(s.homes).toEqual({ builtin: '', flightaxis: '' })
  })
})

describe('writing a home', () => {
  it('touches only the slot in force, and persists it', async () => {
    const store = await freshStore()
    store.setPhysics({ kind: 'flightaxis' })
    store.setHomeText('40.05,-88.55')
    const mod = await import('./sim-store')
    expect(mod.useSimStore.getState().homes).toEqual({ builtin: '', flightaxis: '40.05,-88.55' })
    expect(JSON.parse(localStorage.getItem(HOME_KEY)!)).toEqual({
      builtin: '',
      flightaxis: '40.05,-88.55',
    })
  })
})
