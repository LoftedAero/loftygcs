import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { defaultAxis, isSelected, MAX_AXES, useLogStore } from './log-store'

const bytes = new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz')))
const store = () => useLogStore.getState()

beforeEach(() => store().clear())

describe('loading a log', () => {
  it('parses it and plots nothing until asked', () => {
    store().loadBytes('flight.bin', bytes)
    expect(store().status).toEqual({ kind: 'ready', name: 'flight.bin' })
    expect(store().log!.messages.size).toBeGreaterThan(50)
    // It used to open on an altitude trace, which was a guess at what the
    // reader came for -- and a wrong guess is a field to remove before
    // starting rather than a head start.
    expect(store().selected).toEqual([])
  })

  it('refuses a file that is not a log, without throwing', () => {
    const junk = new Uint8Array(256)
    junk.fill(7)
    store().loadBytes('holiday.jpg', junk)
    expect(store().log).toBeNull()
    expect(store().status).toMatchObject({ kind: 'error' })
    expect((store().status as { text: string }).text).toMatch(/not a dataflash log/)
  })

  it('forgets the previous log when closed', () => {
    store().loadBytes('flight.bin', bytes)
    store().clear()
    expect(store().log).toBeNull()
    expect(store().selected).toEqual([])
    expect(store().status).toEqual({ kind: 'empty' })
  })
})

describe('choosing fields to plot', () => {
  beforeEach(() => store().loadBytes('flight.bin', bytes))

  it('adds and removes a field, keeping the order they were added in', () => {
    store().clearFields()
    store().toggleField({ message: 'RCOU', field: 'C1' })
    store().toggleField({ message: 'ATT', field: 'Roll' })
    expect(store().selected.map((f) => `${f.message}.${f.field}`)).toEqual([
      'RCOU.C1',
      'ATT.Roll',
    ])
    store().toggleField({ message: 'RCOU', field: 'C1' })
    expect(store().selected.map((f) => f.field)).toEqual(['Roll'])
  })

  it('tells the picker what is already on', () => {
    store().clearFields()
    store().toggleField({ message: 'RCOU', field: 'C1' })
    expect(isSelected(useLogStore.getState(), { message: 'RCOU', field: 'C1' })).toBe(true)
    // Same field name, different message: not the same series.
    expect(isSelected(useLogStore.getState(), { message: 'RCIN', field: 'C1' })).toBe(false)
  })
})

describe('assigning fields to y axes', () => {
  beforeEach(() => {
    store().loadBytes('flight.bin', bytes)
    store().clearFields()
  })

  it('puts fields sharing a unit on the same axis', () => {
    // Adding Pitch after Roll means comparing them, and separate scales
    // would draw two different pictures of the same wobble.
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().toggleField({ message: 'ATT', field: 'Pitch' })
    expect(store().selected.map((f) => f.axis)).toEqual([0, 0])
  })

  it('gives a different unit its own axis', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' }) // deg
    store().toggleField({ message: 'RCOU', field: 'C1' }) // us
    const axes = store().selected.map((f) => f.axis)
    expect(axes[0]).not.toBe(axes[1])
  })

  it('moves a field when told to, and only that field', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().toggleField({ message: 'ATT', field: 'Pitch' })
    store().setFieldAxis({ message: 'ATT', field: 'Pitch' }, 2)
    expect(store().selected.map((f) => f.axis)).toEqual([0, 2])
  })

  it('refuses an axis that does not exist', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().setFieldAxis({ message: 'ATT', field: 'Roll' }, 99)
    expect(store().selected[0]!.axis).toBe(MAX_AXES - 1)
    store().setFieldAxis({ message: 'ATT', field: 'Roll' }, -3)
    expect(store().selected[0]!.axis).toBe(0)
  })

  it('gathers everything onto one axis, or spreads it out again', () => {
    for (const f of ['Roll', 'Pitch', 'DesRoll']) {
      store().toggleField({ message: 'ATT', field: f })
    }
    store().gatherAxes('each')
    expect(store().selected.map((f) => f.axis)).toEqual([0, 1, 2])
    store().gatherAxes('one')
    expect(store().selected.map((f) => f.axis)).toEqual([0, 0, 0])
  })

  it('does not spread past the last axis there is', () => {
    for (const f of ['Roll', 'Pitch', 'DesRoll', 'DesPitch', 'Yaw', 'DesYaw']) {
      store().toggleField({ message: 'ATT', field: f })
    }
    store().gatherAxes('each')
    expect(Math.max(...store().selected.map((f) => f.axis))).toBe(MAX_AXES - 1)
  })
})

describe('defaultAxis', () => {
  it('takes the next free axis for each new unit', () => {
    expect(defaultAxis([], 'm')).toBe(0)
    expect(defaultAxis([{ axis: 0, unit: 'm' }], 'us')).toBe(1)
    expect(defaultAxis([{ axis: 0, unit: 'm' }, { axis: 1, unit: 'us' }], 'deg')).toBe(2)
  })

  it('reuses the axis already holding that unit', () => {
    expect(defaultAxis([{ axis: 0, unit: 'm' }, { axis: 1, unit: 'us' }], 'us')).toBe(1)
  })

  it('treats "no unit" as no reason to share', () => {
    // Two unitless fields are not thereby the same quantity, and stacking
    // every unlabelled field on one axis is how they all become flat lines.
    expect(defaultAxis([{ axis: 0, unit: '' }], '')).toBe(1)
  })

  it('joins the busiest axis once they are all in use', () => {
    // Crowded beats invisible, and the field can be moved afterwards.
    const full = [
      { axis: 0, unit: 'a' },
      { axis: 0, unit: 'a' },
      { axis: 1, unit: 'b' },
      { axis: 2, unit: 'c' },
      { axis: 3, unit: 'd' },
    ]
    expect(defaultAxis(full, 'e')).toBe(0)
  })
})
