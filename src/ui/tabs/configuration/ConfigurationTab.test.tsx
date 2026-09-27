import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConfigurationTab from './ConfigurationTab'
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

// Configuration draws from what the aircraft reports: a multirotor has
// FRAME_CLASS, MOT_* and ATC_*; ArduPlane has none of those, carries Q_ENABLE,
// and gains Q_M_*/Q_A_* only once that is on. Every name below was read from
// SITL (Copter 4.7.1, ArduPlane 4.7.1, and the same plane as a quadplane).

const entry = (value: number) => ({ value, origValue: value, mavType: 4, dirty: false })

function seed(names: Record<string, number>) {
  useParamStore.setState({
    entries: new Map(Object.entries(names).map(([k, v]) => [k, entry(v)])),
    loadState: 'ready',
    metadata: {},
  } as never)
}

afterEach(() => {
  cleanup()
  useParamStore.setState({ entries: new Map(), loadState: 'idle' } as never)
})

describe('Configuration, per vehicle', () => {
  it('shows the frame and the tune for a multirotor', () => {
    seed({ FRAME_CLASS: 1, FRAME_TYPE: 1, MOT_THST_EXPO: 0.65, ATC_ACC_R_MAX: 1100 })
    render(<ConfigurationTab />)
    expect(screen.getByText('Frame')).toBeTruthy()
    expect(screen.getByText('Initial tune')).toBeTruthy()
    expect(screen.queryByText('VTOL')).toBeNull()
    // The multirotor spelling of the set, and only what this vehicle has.
    expect(screen.getByText('MOT_THST_EXPO')).toBeTruthy()
    expect(screen.queryByText('Q_M_THST_EXPO')).toBeNull()
  })

  it('shows VTOL rather than Frame for a plane, and no tune without motors', () => {
    // A pure fixed wing: Q_ENABLE present and off, so no VTOL motors.
    seed({ Q_ENABLE: 0, INS_GYRO_FILTER: 20, INS_ACCEL_FILTER: 20, RLL_RATE_P: 0.08 })
    render(<ConfigurationTab />)
    expect(screen.getByText('VTOL')).toBeTruthy()
    expect(screen.queryByText('Frame')).toBeNull()
    expect(screen.queryByText('Initial tune')).toBeNull()
  })

  // ArduPlane 4.4 renamed the envelope off its centi-unit names; on 4.7.1
  // TRIM_ARSPD_CM, ARSPD_FBW_MIN/MAX, LIM_ROLL_CD and LIM_PITCH_MAX/MIN are
  // absent, so a card built on them has no rows.
  it('carries the airspeed and envelope a fixed wing actually reports', () => {
    seed({
      Q_ENABLE: 0,
      ARSPD_TYPE: 2,
      ARSPD_USE: 1,
      AIRSPEED_MIN: 10,
      AIRSPEED_CRUISE: 22,
      AIRSPEED_MAX: 30,
      AIRSPEED_STALL: 0,
      ROLL_LIMIT_DEG: 65,
      PTCH_LIM_MAX_DEG: 25,
      PTCH_LIM_MIN_DEG: -20,
      STALL_PREVENTION: 1,
      TRIM_THROTTLE: 50,
    })
    render(<ConfigurationTab />)
    expect(screen.getByText('Airspeed')).toBeTruthy()
    expect(screen.getByText('Cruise airspeed')).toBeTruthy()
    // The attitude limits moved to Tuning's Attitude card.
    expect(screen.queryByText('Flight envelope')).toBeNull()
    expect(screen.queryByText('ROLL_LIMIT_DEG')).toBeNull()
    // Parameter names are shown on the labels.
    expect(screen.getByText('AIRSPEED_CRUISE')).toBeTruthy()
    // Cruise throttle sits with the speeds.
    expect(screen.getByText('TRIM_THROTTLE')).toBeTruthy()
    expect(screen.queryByText('STALL_PREVENTION')).toBeNull()
  })

  it('tunes a quadplane through its Q_ parameters', () => {
    seed({
      Q_ENABLE: 1,
      Q_FRAME_CLASS: 1,
      Q_FRAME_TYPE: 1,
      Q_M_THST_EXPO: 0.65,
      Q_M_BAT_VOLT_MAX: 12.6,
      Q_A_ACC_R_MAX: 1100,
      INS_GYRO_FILTER: 20,
    })
    render(<ConfigurationTab />)
    expect(screen.getByText('VTOL')).toBeTruthy()
    expect(screen.getByText('Initial tune')).toBeTruthy()
    expect(screen.getByText('Q_M_THST_EXPO')).toBeTruthy()
    expect(screen.getByText('Q_A_ACC_R_MAX')).toBeTruthy()
    // Computed by the calculation but dropped: this aircraft does not report it.
    expect(screen.queryByText('MOT_THST_EXPO')).toBeNull()
  })

  it('writes Q_ENABLE when chosen and re-reads, which is where the VTOL set comes from', async () => {
    // On ArduPlane 4.7.1, Q_ENABLE=1 exposes ~200 Q_ parameters without a
    // restart, but only to a GCS that reads the list again.
    useConnectionStore.setState({ phase: 'connected' } as never)
    seed({ Q_ENABLE: 0, AIRSPEED_CRUISE: 22 })
    useParamStore.setState({
      metadata: { Q_ENABLE: { values: { 0: 'Disabled', 1: 'Enabled' } } },
    } as never)
    render(<ConfigurationTab />)
    const select = screen.getByText('Q_ENABLE').closest('.la-field')!.querySelector('select')!
    fireEvent.change(select, { target: { value: '1' } })
    expect(setParamNow).toHaveBeenCalledWith('Q_ENABLE', 1)
    await waitFor(() => expect(refreshParams).toHaveBeenCalledWith({ quiet: true }))
    useConnectionStore.setState({ phase: 'idle' } as never)
  })

  // Revert and Write are absent, not grayed, until the card has staged edits,
  // so the card with edits stands out. The title's min-height keeps the card
  // from changing height.
  it('shows no card actions until something is staged', () => {
    seed({ Q_ENABLE: 0, AIRSPEED_CRUISE: 22, ROLL_LIMIT_DEG: 65 })
    const { rerender } = render(<ConfigurationTab />)
    expect(screen.queryByRole('button', { name: 'Revert' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Write/ })).toBeNull()

    useParamStore.getState().edit('AIRSPEED_CRUISE', 24)
    rerender(<ConfigurationTab />)
    expect(screen.getByRole('button', { name: 'Revert' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Write (1)' })).toBeTruthy()
  })
})
