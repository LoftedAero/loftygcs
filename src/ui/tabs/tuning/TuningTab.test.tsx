import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import TuningTab from './TuningTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'

// Which names the page draws. 4.7 renamed most of the navigation set, and the
// page showed none of it on current firmware; both spellings are listed, and
// a vehicle reports one.

const entry = (value: number) => ({ value, origValue: value, mavType: 9, dirty: false })

function seed(
  names: Record<string, number>,
  metadata: Record<string, { units?: string; values?: Record<string, string> }> = {},
) {
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
})

const shown = () => [...document.querySelectorAll('.la-field__param')].map((e) => e.textContent)
const titles = () => [...document.querySelectorAll('.la-card__title')].map((e) => e.textContent)

const COPTER_47 = {
  ATC_RAT_RLL_P: 0.135,
  ATC_ANG_RLL_P: 4.5,
  ATC_ACC_R_MAX: 1100,
  INS_GYRO_FILTER: 20,
  AUTOTUNE_AXES: 7,
  PSC_D_ACC_P: 0.05,
  WP_SPD: 10,
  PILOT_SPD_UP: 2.5,
  ATC_ANGLE_MAX: 30,
}

describe('the Tuning page', () => {
  it('draws Copter 4.7’s renamed navigation set', () => {
    seed(COPTER_47)
    render(<TuningTab />)
    expect(shown()).toEqual(expect.arrayContaining(['WP_SPD', 'PILOT_SPD_UP', 'ATC_ANGLE_MAX']))
    // PSC_D_ACC_P is a matrix cell rather than a named row.
    expect(titles()).toContain('Vertical position controller')
  })

  it('still draws the names firmware before 4.7 reports', () => {
    seed({ ATC_RAT_RLL_P: 0.135, PSC_ACCZ_P: 0.5, WPNAV_SPEED: 1000, ANGLE_MAX: 3000 })
    render(<TuningTab />)
    expect(shown()).toEqual(expect.arrayContaining(['WPNAV_SPEED', 'ANGLE_MAX']))
    expect(titles()).toContain('Vertical position controller')
  })

  it('takes a matrix column’s unit from the metadata, not from the page', () => {
    // ATC_ACC_R_MAX is deg/s/s on 4.7; the page used to say cdeg/s/s.
    seed(COPTER_47, { ATC_ACC_R_MAX: { units: 'deg/s/s' } })
    render(<TuningTab />)
    const heads = [...document.querySelectorAll('.app-table__head')].map((h) => h.textContent)
    expect(heads.some((h) => h?.includes('Accel max deg/s/s'))).toBe(true)
  })

  it('gives a plane Mission Planner’s fixed-wing set', () => {
    seed({
      RLL_RATE_P: 0.3,
      PTCH_RATE_P: 0.15,
      RLL2SRV_TCONST: 0.25,
      ROLL_LIMIT_DEG: 65,
      PTCH_LIM_MAX_DEG: 25,
      PTCH_LIM_MIN_DEG: -20,
      YAW2SRV_DAMP: 0,
      NAVL1_PERIOD: 15,
      TECS_CLMB_MAX: 5,
      THR_MAX: 100,
      INS_GYRO_FILTER: 20,
      AUTOTUNE_LEVEL: 6,
    })
    render(<TuningTab />)
    expect(titles()).toEqual(expect.arrayContaining(['Attitude', 'L1 navigation', 'TECS']))
    // The yaw damper and throttle limits are left to the Parameters table.
    expect(titles()).not.toContain('Yaw damper')
    expect(titles()).not.toContain('Throttle')
    expect(shown()).not.toContain('YAW2SRV_DAMP')
    expect(shown()).not.toContain('THR_MAX')
    // The attitude limits, which moved here from Configuration.
    expect(shown()).toEqual(
      expect.arrayContaining(['ROLL_LIMIT_DEG', 'PTCH_LIM_MAX_DEG', 'PTCH_LIM_MIN_DEG']),
    )
    // None of the multirotor cards, and two columns: a plane fits in two.
    expect(document.querySelectorAll('.config-screen > .app-stack')).toHaveLength(2)
    expect(titles().some((t) => /VTOL|control/.test(t ?? ''))).toBe(false)
  })

  it('shows a quadplane’s two sets one at a time, each laid out as its own page', () => {
    seed({
      RLL_RATE_P: 0.3,
      NAVL1_PERIOD: 15,
      AUTOTUNE_LEVEL: 6,
      Q_A_RAT_RLL_P: 0.25,
      Q_P_D_ACC_P: 0.3,
      Q_WP_SPD: 5,
      Q_A_ANGLE_MAX: 30,
      Q_AUTOTUNE_AXES: 7,
    })
    render(<TuningTab />)
    const tab = (name: string) => screen.getByRole('tab', { name })
    const columns = () =>
      [...document.querySelectorAll('.config-screen > .app-stack')].map((c) =>
        [...c.querySelectorAll('.la-card__title')].map((t) => t.textContent),
      )

    // Fixed wing first: the Plane page, card for card.
    expect(tab('Fixed wing').getAttribute('aria-selected')).toBe('true')
    expect(columns()).toEqual([['Autotune', 'Rate gains', 'L1 navigation'], []])
    expect(shown()).not.toContain('Q_WP_SPD')

    // VTOL: the Copter page, under its own titles, on the Q_ names.
    fireEvent.click(tab('VTOL'))
    expect(columns()).toEqual([
      ['Autotune', 'Rate gains', 'Attitude'],
      ['Vertical position controller', 'Navigation'],
    ])
    expect(shown()).toEqual(
      expect.arrayContaining(['Q_WP_SPD', 'Q_A_ANGLE_MAX', 'Q_AUTOTUNE_AXES']),
    )
    expect(shown()).not.toContain('AUTOTUNE_LEVEL')
  })

  it('puts Quicktune in the VTOL autotune card, as official hardware builds carry it', () => {
    // CubeOrange's ArduPlane 4.7.1, measured: no Q_AUTOTUNE_ at all, and
    // QWIK_ENABLE alone until it is switched on.
    seed({ RLL_RATE_P: 0.3, Q_A_RAT_RLL_P: 0.25, QWIK_ENABLE: 0 })
    render(<TuningTab />)
    fireEvent.click(screen.getByRole('tab', { name: 'VTOL' }))
    const card = [...document.querySelectorAll('.la-card')].find(
      (c) => c.querySelector('.la-card__title')?.textContent === 'Autotune',
    )!
    const rows = [...card.querySelectorAll('.la-field')].map((f) => [
      f.querySelector('.la-field__param')?.textContent,
      !!f.querySelector('select:disabled, input:disabled, button:disabled'),
    ])
    expect(rows).toEqual([
      ['QWIK_ENABLE', false],
      ['QWIK_AXES', true],
      ['QWIK_AUTO_SAVE', true],
      ['QWIK_OPTIONS', true],
    ])
  })

  it('reserves no Quicktune rows on a build without it', () => {
    seed({ RLL_RATE_P: 0.3, Q_A_RAT_RLL_P: 0.25, Q_AUTOTUNE_AXES: 7 })
    render(<TuningTab />)
    fireEvent.click(screen.getByRole('tab', { name: 'VTOL' }))
    expect(shown()).toContain('Q_AUTOTUNE_AXES')
    expect(shown().some((n) => n?.startsWith('QWIK_'))).toBe(false)
  })

  it('draws no view switch for a Copter or a plane', () => {
    seed(COPTER_47)
    render(<TuningTab />)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('puts the lean limit and input time constant under the angle gains', () => {
    seed(COPTER_47)
    render(<TuningTab />)
    const attitude = [...document.querySelectorAll('.la-card')].find(
      (c) => c.querySelector('.la-card__title')?.textContent === 'Attitude',
    )!
    expect(attitude.querySelector('.matrix-grid')).toBeTruthy()
    expect([...attitude.querySelectorAll('.la-field__param')].map((e) => e.textContent)).toEqual([
      'ATC_ANGLE_MAX',
    ])
    expect(titles()).not.toContain('Rate filters')
  })

  it('labels the input time constant’s presets with their seconds', () => {
    // ArduPilot's own @Values for ATC_INPUT_TC, as the metadata serves them.
    const values = {
      '0.5': 'Very Soft',
      '0.2': 'Soft',
      '0.15': 'Medium',
      '0.1': 'Crisp',
      '0.05': 'Very Crisp',
    }
    seed({ ...COPTER_47, ATC_INPUT_TC: 0.15 }, { ATC_INPUT_TC: { values, units: 's' } })
    render(<TuningTab />)
    const select = [...document.querySelectorAll('.la-field')]
      .find((f) => f.querySelector('.la-field__param')?.textContent === 'ATC_INPUT_TC')!
      .querySelector('select')!
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Very Soft (0.5)',
      'Soft (0.2)',
      'Medium (0.15)',
      'Crisp (0.1)',
      'Very Crisp (0.05)',
    ])
    expect(select.value).toBe('0.15')
  })

  it('leaves the IMU filters to the Filters page', () => {
    seed({ ...COPTER_47, INS_HNTCH_ENABLE: 0, INS_LOG_BAT_MASK: 0 })
    render(<TuningTab />)
    expect(titles().some((t) => /notch|Filtering|sampler/i.test(t ?? ''))).toBe(false)
    expect(shown()).not.toContain('INS_GYRO_FILTER')
  })

  it('heads a column with a unit only when the whole column shares it', () => {
    seed(
      { ...COPTER_47, PSC_D_ACC_IMAX: 80, PSC_NE_VEL_IMAX: 10 },
      { PSC_D_ACC_IMAX: { units: 'd%' }, PSC_NE_VEL_IMAX: { units: 'm/s/s' } },
    )
    render(<TuningTab />)
    const heads = [...document.querySelectorAll('.app-table__head')].map((h) => h.textContent)
    expect(heads.some((h) => h?.includes('I max d%'))).toBe(true)
    expect(heads.some((h) => h?.includes('I max m/s/s'))).toBe(true)
  })

  it('counts an edit on the card that shows it, and nowhere else', () => {
    seed(COPTER_47)
    render(<TuningTab />)
    act(() => useParamStore.getState().edit('WP_SPD', 12))
    const writes = [...document.querySelectorAll('.la-card')]
      .map((c) => [
        c.querySelector('.la-card__title')?.textContent,
        [...c.querySelectorAll('.la-card__actions button')].map((b) => b.textContent).join(' '),
      ])
      .filter(([, b]) => b)
    expect(writes).toEqual([['Navigation', 'Revert Write (1)']])
  })
})
