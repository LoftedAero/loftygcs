import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { getSeries } from '../protocol/dataflash'
import { defaultAxis, isSelected, MAX_AXES, traceSeries, useLogStore } from './log-store'

const bytes = new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz')))
const store = () => useLogStore.getState()

beforeEach(() => store().clear())

describe('loading a log', () => {
  it('parses it and plots nothing until asked', () => {
    store().loadBytes('flight.bin', bytes)
    expect(store().status).toEqual({ kind: 'ready', name: 'flight.bin' })
    expect(store().log!.messages.size).toBeGreaterThan(50)
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
    expect(store().selected.map((f) => `${f.message}.${f.field}`)).toEqual(['RCOU.C1', 'ATT.Roll'])
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

describe('the upper pane follows what was asked for', () => {
  beforeEach(() => store().loadBytes('flight.bin', bytes))

  it('opens on the replay alone, with no pane above it', () => {
    expect(store().upper).toBe('none')
  })

  it('opens the plot when a field is picked, and closes it with the last one', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    expect(store().upper).toBe('plot')
    store().toggleField({ message: 'ATT', field: 'Roll' })
    expect(store().upper).toBe('none')
  })

  it('leaves the table alone when a field is removed from under it', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().setUpper('table')
    store().toggleField({ message: 'ATT', field: 'Roll' })
    expect(store().upper).toBe('table')
  })

  it('splits the window evenly the first time a pane opens', () => {
    store().setSplit(0.8)
    store().setUpper('none')
    store().setUpper('plot')
    expect(store().split).toBe(0.5)
    // Not again: after that the divider stays where it was put.
    store().setSplit(0.3)
    store().setUpper('table')
    expect(store().split).toBe(0.3)
  })
})

describe('plotting an expression', () => {
  beforeEach(() => {
    store().loadBytes('flight.bin', bytes)
    store().clearFields()
  })

  it('adds a computed trace and opens the plot for it', () => {
    expect(store().addExpression('ATT.DesRoll - ATT.Roll')).toBeNull()
    expect(store().upper).toBe('plot')
    expect(store().selected[0]).toMatchObject({ expression: 'ATT.DesRoll - ATT.Roll' })
  })

  it('computes its samples on demand', () => {
    store().addExpression('BARO.Alt * 2')
    const s = traceSeries(store().log!, store().selected[0]!)!
    const alt = getSeries(store().log!, 'BARO', 'Alt')!
    expect(s.values.length).toBe(alt.values.length)
    expect(s.values[5]).toBeCloseTo(alt.values[5]! * 2, 9)
  })

  it('names the problem rather than adding a broken trace', () => {
    expect(store().addExpression('ATT.Nope + 1')).toMatch(/no ATT\.Nope/)
    expect(store().addExpression('2 + 2')).toMatch(/nothing to plot/)
    expect(store().addExpression('   ')).toMatch(/Type an expression/)
    expect(store().selected).toEqual([])
    // And none of that opened a plot with nothing on it.
    expect(store().upper).toBe('none')
  })

  it('refuses the same expression twice', () => {
    expect(store().addExpression('ATT.Roll * 2')).toBeNull()
    expect(store().addExpression('  ATT.Roll * 2  ')).toMatch(/already plotted/)
    expect(store().selected).toHaveLength(1)
  })

  it('gives an expression its own axis rather than a unit it does not have', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().addExpression('ATT.DesRoll - ATT.Roll')
    expect(store().selected[1]!.axis).not.toBe(store().selected[0]!.axis)
  })

  it('removes it again by the same toggle a field uses', () => {
    store().addExpression('ATT.Roll * 2')
    store().toggleField(store().selected[0]!)
    expect(store().selected).toEqual([])
  })
})

describe('saved plot setups', () => {
  beforeEach(() => {
    localStorage.clear()
    useLogStore.setState({ presets: {} })
    store().loadBytes('flight.bin', bytes)
    store().clearFields()
  })

  it('brings back the fields, axes, colors and expressions', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().addExpression('ATT.DesRoll - ATT.Roll')
    store().setFieldColor({ message: 'ATT', field: 'Roll' }, '#123456')
    store().setFieldAxis({ message: 'ATT', field: 'Roll' }, 2)
    store().savePreset('attitude')

    store().clearFields()
    expect(store().selected).toEqual([])
    store().loadPreset('attitude')
    expect(store().selected).toHaveLength(2)
    expect(store().selected[0]).toMatchObject({ field: 'Roll', color: '#123456', axis: 2 })
    expect(store().selected[1]!.expression).toBe('ATT.DesRoll - ATT.Roll')
    expect(store().upper).toBe('plot')
  })

  it('survives the store being rebuilt, which is the whole point', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().savePreset('attitude')
    expect(JSON.parse(localStorage.getItem('loftgcs.logs.presets')!)).toHaveProperty('attitude')
  })

  it('replaces a preset saved under a name already used', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().savePreset('one')
    store().toggleField({ message: 'ATT', field: 'Pitch' })
    store().savePreset('one')
    expect(Object.keys(store().presets)).toEqual(['one'])
    expect(store().presets['one']).toHaveLength(2)
  })

  it('forgets one when deleted', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().savePreset('one')
    store().deletePreset('one')
    expect(store().presets).toEqual({})
    expect(JSON.parse(localStorage.getItem('loftgcs.logs.presets')!)).toEqual({})
  })

  it('keeps its presets when a log is closed', () => {
    store().toggleField({ message: 'ATT', field: 'Roll' })
    store().savePreset('one')
    store().clear()
    expect(Object.keys(store().presets)).toEqual(['one'])
  })
})

describe('assigning fields to y axes', () => {
  beforeEach(() => {
    store().loadBytes('flight.bin', bytes)
    store().clearFields()
  })

  it('puts fields sharing a unit on the same axis', () => {
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
    expect(
      defaultAxis(
        [
          { axis: 0, unit: 'm' },
          { axis: 1, unit: 'us' },
        ],
        'deg',
      ),
    ).toBe(2)
  })

  it('reuses the axis already holding that unit', () => {
    expect(
      defaultAxis(
        [
          { axis: 0, unit: 'm' },
          { axis: 1, unit: 'us' },
        ],
        'us',
      ),
    ).toBe(1)
  })

  it('treats "no unit" as no reason to share', () => {
    // Two unitless fields are not necessarily the same quantity.
    expect(defaultAxis([{ axis: 0, unit: '' }], '')).toBe(1)
  })

  it('joins the busiest axis once they are all in use', () => {
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
