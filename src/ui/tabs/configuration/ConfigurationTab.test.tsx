import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ConfigurationTab from './ConfigurationTab'
import { useParamStore } from '../../../stores/param-store'

// Configuration draws itself from what the aircraft reports, because the two
// vehicles have almost nothing in common here: a multirotor has FRAME_CLASS,
// MOT_* and ATC_*; ArduPlane has none of those, carries Q_ENABLE, and grows
// Q_M_*/Q_A_* for its VTOL motors only once that is on. Every name below was
// measured against SITL -- Copter 4.7.1, ArduPlane 4.7.1, and the same plane
// launched as a quadplane.

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
    // A pure fixed wing: Q_ENABLE present and off, so no VTOL motors exist
    // and there is nothing to compute from a propeller size.
    seed({ Q_ENABLE: 0, INS_GYRO_FILTER: 20, INS_ACCEL_FILTER: 20, RLL_RATE_P: 0.08 })
    render(<ConfigurationTab />)
    expect(screen.getByText('VTOL')).toBeTruthy()
    expect(screen.queryByText('Frame')).toBeNull()
    expect(screen.queryByText('Initial tune')).toBeNull()
  })

  // The spellings are the point of this one. ArduPlane 4.4 renamed the whole
  // envelope off its centi-unit names, and a card built on the old ones is a
  // card of no rows: measured on 4.7.1, TRIM_ARSPD_CM, ARSPD_FBW_MIN/MAX,
  // LIM_ROLL_CD and LIM_PITCH_MAX/MIN all come back absent.
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
    expect(screen.getByText('Flight envelope')).toBeTruthy()
    expect(screen.getByText('Cruise airspeed')).toBeTruthy()
    expect(screen.getByText('Roll limit')).toBeTruthy()
    // The names go on the labels, because this is where somebody carries an
    // answer between the wiki, the forums and the Parameters tab.
    expect(screen.getByText('AIRSPEED_CRUISE')).toBeTruthy()
    expect(screen.getByText('ROLL_LIMIT_DEG')).toBeTruthy()
    // The throttle that holds the cruise speed reads with the speeds, not with
    // the attitude limits.
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
    // The multirotor family is offered by the calculation and dropped here,
    // because this aircraft does not report it.
    expect(screen.queryByText('MOT_THST_EXPO')).toBeNull()
  })

  // A card's Revert and Write are absent until it has something to send, not
  // present and greyed: a screenful of permanently disabled buttons made the
  // one card carrying staged edits no easier to find than the rest. The card
  // does not change height for it -- the title's own min-height holds the row
  // open -- which is what makes appearing and disappearing safe here.
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
