import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { isSelected, useLogStore } from './log-store'

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
    expect(store().selected).toEqual([
      { message: 'RCOU', field: 'C1' },
      { message: 'ATT', field: 'Roll' },
    ])
    store().toggleField({ message: 'RCOU', field: 'C1' })
    expect(store().selected).toEqual([{ message: 'ATT', field: 'Roll' }])
  })

  it('tells the picker what is already on', () => {
    store().clearFields()
    store().toggleField({ message: 'RCOU', field: 'C1' })
    expect(isSelected(useLogStore.getState(), { message: 'RCOU', field: 'C1' })).toBe(true)
    // Same field name, different message: not the same series.
    expect(isSelected(useLogStore.getState(), { message: 'RCIN', field: 'C1' })).toBe(false)
  })
})
