import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import OutputsTab from './OutputsTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'

// Which cards the Outputs screen offers, per vehicle. The one that matters is
// the motor test: ArduPlane's lives entirely inside `#if HAL_QUADPLANE_ENABLED`
// and its entry point answers MAV_RESULT_FAILED when Q_ENABLE is 0, so on a
// fixed wing every button on it is a refusal.

vi.mock('../../../stores/guide-store', () => ({
  useProfileLabels: () => ({ outputLabels: {}, channelLabels: {} }),
}))

const entry = (value: number) => ({ value, origValue: value, mavType: 4, dirty: false })

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
  useParamStore.setState({ entries: new Map(), loadState: 'idle' } as never)
  useConnectionStore.setState({ phase: 'idle' } as never)
})

const OUTPUTS = { SERVO1_FUNCTION: 33, SERVO1_MIN: 1100, SERVO1_TRIM: 1500, SERVO1_MAX: 1900 }

describe('the Outputs screen, per vehicle', () => {
  it('offers the motor test to a multirotor', () => {
    seed({ ...OUTPUTS, MOT_PWM_TYPE: 0, MOT_SPIN_MIN: 0.15 })
    render(<OutputsTab />)
    expect(screen.getByText('Motor test')).toBeTruthy()
  })

  it('withholds it from a fixed wing', () => {
    // Q_ENABLE reported and off: ArduPlane would refuse every button.
    seed({ ...OUTPUTS, Q_ENABLE: 0, SERVO_RATE: 50 })
    render(<OutputsTab />)
    expect(screen.queryByText('Motor test')).toBeNull()
    // The rest of the screen is still its own: a plane has servo outputs and
    // an output protocol, it just has no motors to spin.
    expect(screen.getByText('Servo outputs')).toBeTruthy()
    expect(screen.getByText('Output options')).toBeTruthy()
  })

  it('gives it back once the VTOL motors are on', () => {
    seed({ ...OUTPUTS, Q_ENABLE: 1, Q_M_PWM_TYPE: 0 })
    render(<OutputsTab />)
    expect(screen.getByText('Motor test')).toBeTruthy()
  })

  it('leaves it alone for a vehicle that never mentions Q_ENABLE', () => {
    // Rover ships its own motor test, and reports no Q_ENABLE at all -- a gate
    // on "has multirotor motors" would have taken it away.
    seed({ ...OUTPUTS, SERVO_RATE: 50 })
    render(<OutputsTab />)
    expect(screen.getByText('Motor test')).toBeTruthy()
  })
})

describe('while the parameters are still arriving', () => {
  it('shows one placeholder, not a placeholder beside half a screen', () => {
    // The reported bug: the link comes back after a reboot, the download runs,
    // and the screen drew the Motor test and Output protocol cards next to a
    // "waiting for parameters" card. Three answers to one question.
    useConnectionStore.setState({ phase: 'connected' } as never)
    useParamStore.setState({
      entries: new Map(),
      loadState: 'downloading',
      metadata: {},
    } as never)
    render(<OutputsTab />)
    expect(screen.queryByText('Motor test')).toBeNull()
    expect(screen.queryByText('Output options')).toBeNull()
    expect(screen.queryByText('Servo outputs')).toBeNull()
    expect(screen.getByText('Outputs')).toBeTruthy()
    expect(screen.queryByText(/Reading the vehicle/)).not.toBeNull()
  })
})
