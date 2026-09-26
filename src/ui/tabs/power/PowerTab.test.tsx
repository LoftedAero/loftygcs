import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PowerTab from './PowerTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Names and values read off a running 4.7.1 SITL.

const entry = (value: number) => ({ value, origValue: value, mavType: 9, dirty: false })

function seed(names: Record<string, number>, metadata: Record<string, unknown> = {}) {
  useConnectionStore.setState({ phase: 'connected' } as never)
  useParamStore.setState({
    entries: new Map(Object.entries(names).map(([k, v]) => [k, entry(v)])),
    loadState: 'ready',
    metadata,
  } as never)
}

afterEach(() => {
  cleanup()
  useParamStore.setState({ entries: new Map(), loadState: 'idle', metadata: {} } as never)
  useConnectionStore.setState({ phase: 'idle' } as never)
  useVehicleStore.setState({ batteries: {}, batteryV: 0, batteryA: 0, batteryPct: -1 } as never)
})

const titles = () => [...document.querySelectorAll('.la-card__title')].map((e) => e.textContent)
const rows = () =>
  [...document.querySelectorAll('.la-field__param')].map((e) => e.textContent).filter(Boolean)
const off = () =>
  [...document.querySelectorAll('.la-field--off .la-field__param')].map((e) => e.textContent)
const field = (p: string) =>
  [...document.querySelectorAll('.la-field')].find(
    (f) => f.querySelector('.la-field__param')?.textContent === p,
  )
const readouts = () => [...document.querySelectorAll('.la-readout')].map((e) => e.textContent)
const battery2 = () => fireEvent.click(screen.getByRole('tab', { name: 'Battery 2' }))

const ANALOG = {
  BATT_MONITOR: 4,
  BATT_CAPACITY: 3300,
  BATT_VOLT_PIN: 13,
  BATT_CURR_PIN: 12,
  BATT_VOLT_MULT: 10.1,
  BATT_AMP_PERVLT: 17,
  BATT_AMP_OFFSET: 0,
  BATT_VLT_OFFSET: 0,
  BATT_OPTIONS: 0,
  BATT_LOW_VOLT: 10.5,
  BATT_FS_LOW_ACT: 0,
  BATT2_MONITOR: 0,
}

describe('the Power page', () => {
  it('draws the same three cards whatever the monitor', () => {
    seed(ANALOG)
    render(<PowerTab />)
    expect(titles()).toEqual(['Live reading', 'Battery monitor', 'Battery failsafe'])
  })

  it('keeps an analog monitor’s rows, greyed, for a monitor that has none', () => {
    seed({ BATT_MONITOR: 8, BATT_CAPACITY: 3300, BATT2_MONITOR: 0 })
    render(<PowerTab />)
    expect(off()).toEqual(
      expect.arrayContaining([
        'BATT_VOLT_PIN',
        'BATT_CURR_PIN',
        'BATT_VOLT_MULT',
        'BATT_AMP_PERVLT',
      ]),
    )
  })

  it('takes units from the metadata rather than writing its own', () => {
    seed(ANALOG, { BATT_CAPACITY: { units: 'mAh' }, BATT_LOW_VOLT: { units: 'V' } })
    render(<PowerTab />)
    const unit = (p: string) => field(p)?.querySelector('.la-field__unit:last-child')?.textContent
    expect(unit('BATT_CAPACITY')).toBe('mAh')
    expect(unit('BATT_VOLT_MULT')).toBe('')
  })
})

describe('the battery switch', () => {
  it('gives the second battery the first one’s whole set, row for row', () => {
    seed(ANALOG)
    render(<PowerTab />)
    const first = rows()
    battery2()
    expect(titles()).toEqual(['Live reading', 'Battery monitor', 'Battery failsafe'])
    expect(rows()).toEqual(first.map((p) => p?.replace(/^BATT_/, 'BATT2_')))
  })

  it('greys everything but the monitor type until the second battery is switched on', () => {
    seed(ANALOG)
    render(<PowerTab />)
    battery2()
    expect(off()).toEqual(rows().filter((p) => p !== 'BATT2_MONITOR'))
  })

  it('draws a reserved row as the control it will become', () => {
    seed(ANALOG, {
      BATT2_CAPACITY: { units: 'mAh' },
      BATT2_FS_LOW_ACT: { values: { 0: 'Warn only', 1: 'Land' } },
    })
    render(<PowerTab />)
    battery2()
    expect(field('BATT2_CAPACITY')?.querySelector('select, input')?.tagName).toBe('INPUT')
    expect(field('BATT2_FS_LOW_ACT')?.querySelector('select, input')?.tagName).toBe('SELECT')
  })

  it('reads each battery’s own pack', () => {
    seed(ANALOG)
    useVehicleStore.setState({
      batteryV: 12.6,
      batteryA: 3.2,
      batteryPct: 80,
      batteries: { 1: { voltageV: 25.2, currentA: 1.5, remainingPct: 90 } },
    } as never)
    render(<PowerTab />)
    expect(readouts()).toEqual(['12.60', '3.2', '80'])
    battery2()
    expect(readouts()).toEqual(['25.20', '1.5', '90'])
  })

  it('shows dashes for a second battery that has said nothing', () => {
    seed(ANALOG)
    useVehicleStore.setState({ batteryV: 12.6, batteries: {} } as never)
    render(<PowerTab />)
    battery2()
    expect(readouts()).toEqual(['', '', ''])
  })
})

describe('a pin named only by its sentinel', () => {
  it('is a number box, not a dropdown of “Disabled” and the pin it is set to', () => {
    seed(ANALOG, { BATT_VOLT_PIN: { values: { '-1': 'Disabled' } } })
    render(<PowerTab />)
    const pin = field('BATT_VOLT_PIN')
    expect(pin?.querySelector('select')).toBeNull()
    expect((pin?.querySelector('input') as HTMLInputElement).value).toBe('13')
  })
})
