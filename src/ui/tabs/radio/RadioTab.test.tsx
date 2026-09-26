import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import RadioTab from './RadioTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Names read off a running 4.7.1 SITL; Copter, Plane and a quadplane report
// the same set.

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
  useVehicleStore.setState({ rcChannels: [] } as never)
})

const RADIO: Record<string, number> = {
  RCMAP_ROLL: 1,
  RCMAP_PITCH: 2,
  RCMAP_THROTTLE: 3,
  RCMAP_YAW: 4,
  RC_PROTOCOLS: 1,
  RC_OPTIONS: 32,
  RC_FS_TIMEOUT: 1,
}
for (let n = 1; n <= 16; n++) RADIO[`RC${n}_OPTION`] = 0

const titles = () => [...document.querySelectorAll('.la-card__title')].map((e) => e.textContent)
const rows = () => [...document.querySelectorAll('.la-field__param')].map((e) => e.textContent)
// The card's monitor: the calibration dialog stays mounted, hidden, with its own.
const bars = () =>
  [...document.querySelectorAll('.la-card .rc-monitor__value')].map((e) => e.textContent)

describe('the Radio page', () => {
  it('draws the sticks down the left and the switches and receiver down the right', () => {
    seed(RADIO)
    render(<RadioTab />)
    expect(titles()).toEqual([
      'Channels',
      'Stick mapping',
      'Auxiliary functions',
      'Receiver options',
    ])
  })

  it('waits for the parameters rather than drawing a page that fills in', () => {
    seed(RADIO)
    useParamStore.setState({ loadState: 'loading' } as never)
    render(<RadioTab />)
    expect(titles()).toEqual(['Radio'])
  })

  it('lists channels 5 to 16 as named rows, the same as every other card', () => {
    seed(RADIO)
    render(<RadioTab />)
    const aux = Array.from({ length: 12 }, (_, i) => `RC${i + 5}_OPTION`)
    expect(rows()).toEqual(expect.arrayContaining(aux))
    expect(document.querySelector('.app-table')).toBeNull()
  })

  it('shows one short protocol by name and counts options that will not fit', () => {
    seed(RADIO, {
      RC_PROTOCOLS: { bitmask: { 0: 'All', 1: 'PPM' } },
      RC_OPTIONS: { bitmask: { 5: 'Arming check throttle for 0 input' } },
    })
    render(<RadioTab />)
    expect([...document.querySelectorAll('.param-bitmask')].map((e) => e.textContent)).toEqual([
      'All',
      '1 selected',
    ])
  })
})

describe('the channel monitor', () => {
  it('is sixteen rows before the receiver says anything', () => {
    seed(RADIO)
    render(<RadioTab />)
    expect(bars()).toEqual(Array(16).fill('—'))
  })

  it('is sixteen rows for an 8-channel receiver, dashes past the eighth', () => {
    seed(RADIO)
    useVehicleStore.setState({
      rcChannels: [1500, 1500, 1000, 1500, 1800, 1000, 1000, 1800],
    } as never)
    render(<RadioTab />)
    expect(bars()).toEqual([
      '1500',
      '1500',
      '1000',
      '1500',
      '1800',
      '1000',
      '1000',
      '1800',
      ...Array(8).fill('—'),
    ])
  })
})
