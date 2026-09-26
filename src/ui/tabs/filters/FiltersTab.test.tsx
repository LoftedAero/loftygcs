import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import FiltersTab from './FiltersTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'

const setParamNow = vi.fn<(name: string, value: number) => Promise<number>>(async (_n, v) => v)
const refreshParams = vi.fn<(opts: { quiet?: boolean }) => Promise<void>>(async () => {})
vi.mock('../../../services/connection', () => ({
  connectionService: {
    setParamNow: (name: string, value: number) => setParamNow(name, value),
    refreshParams: (opts: { quiet?: boolean }) => refreshParams(opts),
  },
}))

const entry = (value: number) => ({ value, origValue: value, mavType: 9, dirty: false })

function seed(names: Record<string, number>) {
  useConnectionStore.setState({ phase: 'connected' } as never)
  useParamStore.setState({
    entries: new Map(Object.entries(names).map(([k, v]) => [k, entry(v)])),
    loadState: 'ready',
    metadata: {},
  } as never)
}

afterEach(() => {
  cleanup()
  useParamStore.setState({ entries: new Map(), loadState: 'idle', metadata: {} } as never)
  useConnectionStore.setState({ phase: 'idle' } as never)
})

const titles = () => [...document.querySelectorAll('.la-card__title')].map((e) => e.textContent)
const cardTitled = (title: string) =>
  [...document.querySelectorAll('.la-card')].find(
    (c) => c.querySelector('.la-card__title')?.textContent === title,
  )!

/** What a 4.7.1 vehicle reports with both notches off: each enable, nothing after it. */
const STOCK = {
  INS_GYRO_FILTER: 20,
  INS_ACCEL_FILTER: 20,
  INS_LOG_BAT_MASK: 0,
  INS_LOG_BAT_OPT: 0,
  INS_HNTCH_ENABLE: 0,
  INS_HNTC2_ENABLE: 0,
}

describe('the Filters page', () => {
  it('draws the IMU card beside the rate filters, then both notches', () => {
    seed({ ...STOCK, ATC_RAT_RLL_FLTT: 20 })
    render(<FiltersTab />)
    // In pairs of rows, so the two notches sit side by side at one height.
    expect(titles()).toEqual([
      'IMU',
      'Rate filters',
      'First harmonic notch',
      'Second harmonic notch',
    ])
  })

  it('reserves each notch’s rows, greyed, until the vehicle reports them', () => {
    // They exist only once the notch is on, so the card is drawn at its full
    // height from the start.
    seed(STOCK)
    render(<FiltersTab />)
    for (const title of ['First harmonic notch', 'Second harmonic notch']) {
      const notch = cardTitled(title)
      // A dropdown or a number box, whichever the row will become.
      const controls = [...notch.querySelectorAll('select, input')] as HTMLInputElement[]
      expect(notch.querySelectorAll('.la-field--named')).toHaveLength(8)
      expect(controls.filter((s) => s.disabled)).toHaveLength(7)
    }
  })

  it('draws the rows live once the notch is on', () => {
    seed({
      ...STOCK,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_MODE: 1,
      INS_HNTCH_REF: 0.35,
      INS_HNTCH_FREQ: 80,
      INS_HNTCH_BW: 40,
      INS_HNTCH_ATT: 40,
      INS_HNTCH_HMNCS: 3,
      INS_HNTCH_OPTS: 0,
    })
    render(<FiltersTab />)
    const first = cardTitled('First harmonic notch')
    expect(first.querySelectorAll('.la-field--off')).toHaveLength(0)
  })

  it('draws no notch card for a firmware without that notch', () => {
    const { INS_HNTC2_ENABLE: _, ...noSecond } = STOCK
    seed(noSecond)
    render(<FiltersTab />)
    expect(titles()).not.toContain('Second harmonic notch')
    expect(titles()).toContain('First harmonic notch')
  })

  it('counts an edit on the card that shows it, and nowhere else', () => {
    seed(STOCK)
    render(<FiltersTab />)
    act(() => useParamStore.getState().edit('INS_LOG_BAT_OPT', 1))
    const writes = [...document.querySelectorAll('.la-card')]
      .map((c) => [
        c.querySelector('.la-card__title')?.textContent,
        [...c.querySelectorAll('.la-card__actions button')].map((b) => b.textContent).join(' '),
      ])
      .filter(([, b]) => b)
    expect(writes).toEqual([['IMU', 'Revert Write (1)']])
  })

  it('draws the rate filters for the vehicle connected, a quadplane’s two sets in one card', () => {
    const params = (title: string) =>
      [...cardTitled(title).querySelectorAll('input, select')].length
    seed({ ...STOCK, ATC_RAT_RLL_FLTT: 20, ATC_RAT_RLL_FLTE: 0, ATC_RAT_RLL_FLTD: 20 })
    render(<FiltersTab />)
    expect(titles()[1]).toBe('Rate filters')
    expect(params('Rate filters')).toBe(3)
    cleanup()

    seed({ ...STOCK, RLL_RATE_P: 0.3, RLL_RATE_FLTT: 3, Q_A_RAT_RLL_P: 0.25, Q_A_RAT_RLL_FLTT: 20 })
    render(<FiltersTab />)
    // The same four cards as any other vehicle: the fixed wing's rows under
    // their own names, the VTOL motors' under Q_A_, in the one card.
    expect(titles()).toEqual([
      'IMU',
      'Rate filters',
      'First harmonic notch',
      'Second harmonic notch',
    ])
    const labels = [...cardTitled('Rate filters').querySelectorAll('.app-table__label')].map(
      (l) => l.textContent,
    )
    expect(labels).toEqual(['Roll', 'VTOL roll'])
    expect(params('Rate filters')).toBe(2)
  })

  it('writes a notch’s enable when chosen and re-reads, which is where its rows come from', async () => {
    // Measured: setting INS_HNTCH_ENABLE exposes the other eight at once, with
    // no restart -- but only to a GCS that reads the list again.
    setParamNow.mockClear()
    refreshParams.mockClear()
    seed(STOCK)
    // The metadata's Values are what make the enable a dropdown.
    useParamStore.setState({
      metadata: { INS_HNTCH_ENABLE: { values: { 0: 'Disabled', 1: 'Enabled' } } },
    } as never)
    render(<FiltersTab />)
    const select = cardTitled('First harmonic notch').querySelector('select')!
    fireEvent.change(select, { target: { value: '1' } })
    expect(setParamNow).toHaveBeenCalledWith('INS_HNTCH_ENABLE', 1)
    await waitFor(() => expect(refreshParams).toHaveBeenCalledWith({ quiet: true }))
  })
})
