import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type JoystickConfig } from '../protocol/joystick'

// The store reads storage once, when it is created, so each test loads a
// fresh copy of the module over whatever storage it has set up.
async function freshStore() {
  vi.resetModules()
  return (await import('./joystick-store')).useJoystickStore
}

const PAD = { index: 0, id: 'Xbox Wireless Controller' }
const WHEEL = { index: 1, id: 'Logitech G920 Wheel' }
const saved = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown

beforeEach(() => localStorage.clear())

describe('a mapping belongs to a device', () => {
  it('keeps an edit as the current device’s own, across a restart', async () => {
    let store = await freshStore()
    store.getState().setPads([PAD], PAD)
    store.getState().setConfig({ deadzone: 0.2 })

    store = await freshStore()
    store.getState().setPads([PAD], PAD)
    expect(store.getState().config.deadzone).toBe(0.2)
  })

  it('brings each device its own mapping back when it is chosen', async () => {
    const store = await freshStore()
    store.getState().setPads([PAD, WHEEL], PAD)
    store.getState().setConfig({ deadzone: 0.2 })
    store.getState().setPads([PAD, WHEEL], WHEEL)
    store.getState().setConfig({ deadzone: 0.02 })

    store.getState().setPads([PAD, WHEEL], PAD)
    expect(store.getState().config.deadzone).toBe(0.2)
    store.getState().setPads([PAD, WHEEL], WHEEL)
    expect(store.getState().config.deadzone).toBe(0.02)
  })

  it('starts a device seen for the first time from the default, not the last device', async () => {
    // A HOTAS has nothing in common with a gamepad's axis numbers.
    const store = await freshStore()
    store.getState().setPads([PAD], PAD)
    store.getState().setConfig({ axes: [] })
    store.getState().setPads([WHEEL], WHEEL)
    expect(store.getState().config).toEqual(DEFAULT_CONFIG)
  })

  it('gives the single mapping an older build kept to the first device', async () => {
    localStorage.setItem(
      'loftgcs.joystick',
      JSON.stringify({ axes: [{ channel: 1, axis: 0, centered: true }], deadzone: 0.15 }),
    )
    const store = await freshStore()
    store.getState().setPads([PAD], PAD)
    expect(store.getState().config.deadzone).toBe(0.15)
    expect(store.getState().config.axes).toHaveLength(1)
    // And only to the first: the second starts from the default.
    store.getState().setPads([WHEEL], WHEEL)
    expect(store.getState().config.deadzone).toBe(DEFAULT_CONFIG.deadzone)
  })

  it('does not swap the mapping while control is taken', async () => {
    const store = await freshStore()
    store.getState().setPads([PAD], PAD)
    store.getState().setConfig({ deadzone: 0.2 })
    store.getState().setActive(true)
    store.getState().setPads([WHEEL], WHEEL)
    expect(store.getState().config.deadzone).toBe(0.2)
  })

  it('sanitizes what storage hands back', async () => {
    localStorage.setItem(
      'loftgcs.joystick.devices',
      JSON.stringify({ [PAD.id]: { axes: [{ channel: 99, axis: 1 }], deadzone: 'lots' } }),
    )
    const store = await freshStore()
    store.getState().setPads([PAD], PAD)
    expect(store.getState().config.axes[0]!.channel).toBe(16)
    expect(store.getState().config.deadzone).toBe(DEFAULT_CONFIG.deadzone)
  })

  it('survives storage that is not JSON at all', async () => {
    localStorage.setItem('loftgcs.joystick.devices', '{nope')
    localStorage.setItem('loftgcs.joystick.profiles', '[1,2')
    const store = await freshStore()
    expect(store.getState().devices).toEqual({})
    expect(store.getState().profiles).toEqual({})
  })
})

describe('named profiles', () => {
  it('saves the current mapping under a name and loads it onto another device', async () => {
    const store = await freshStore()
    store.getState().setPads([PAD, WHEEL], PAD)
    store.getState().setConfig({ deadzone: 0.25 })
    store.getState().saveProfile('Racing')

    store.getState().setPads([PAD, WHEEL], WHEEL)
    expect(store.getState().config.deadzone).toBe(DEFAULT_CONFIG.deadzone)
    store.getState().loadProfile('Racing')
    expect(store.getState().config.deadzone).toBe(0.25)
    // Loading makes it the wheel's own, so it sticks to the wheel.
    const devices = saved('loftgcs.joystick.devices') as Record<string, JoystickConfig>
    expect(devices[WHEEL.id]!.deadzone).toBe(0.25)
  })

  it('keeps profiles across a restart', async () => {
    let store = await freshStore()
    store.getState().saveProfile('Mode 2')
    store = await freshStore()
    expect(Object.keys(store.getState().profiles)).toEqual(['Mode 2'])
  })

  it('will not load a profile while control is taken', async () => {
    const store = await freshStore()
    store.getState().setPads([PAD], PAD)
    store.getState().importProfile('Other', { ...DEFAULT_CONFIG, deadzone: 0.3 })
    store.getState().setActive(true)
    store.getState().loadProfile('Other')
    expect(store.getState().config.deadzone).toBe(DEFAULT_CONFIG.deadzone)
  })

  it('sanitizes an imported file before keeping it', async () => {
    const store = await freshStore()
    store.getState().importProfile('From a file', {
      axes: [],
      buttons: [{ channel: 5, button: 0, mode: 'launch', values: [9999] }],
    })
    const profile = store.getState().profiles['From a file']!
    expect(profile.buttons[0]!.mode).toBe('momentary')
    expect(profile.buttons[0]!.values).toEqual([2200, 2000])
  })

  it('deletes', async () => {
    const store = await freshStore()
    store.getState().saveProfile('A')
    store.getState().saveProfile('B')
    store.getState().deleteProfile('A')
    expect(Object.keys(store.getState().profiles)).toEqual(['B'])
    expect(Object.keys(saved('loftgcs.joystick.profiles') as object)).toEqual(['B'])
  })
})
