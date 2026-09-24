import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OutputsTab from './OutputsTab'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Which cards the Outputs screen offers, per vehicle. The one that matters is
// the motor test: ArduPlane's lives entirely inside `#if HAL_QUADPLANE_ENABLED`
// and its entry point answers MAV_RESULT_FAILED when Q_ENABLE is 0, so on a
// fixed wing every button on it is a refusal.

const setParamNow = vi.fn<(name: string, value: number) => Promise<number>>()
vi.mock('../../../services/connection', () => ({
  connectionService: {
    setParamNow: (name: string, value: number) => setParamNow(name, value),
    runCommand: () => Promise.resolve(0),
    refreshParams: () => Promise.resolve(),
  },
}))

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
  useVehicleStore.setState({ servoOutputsUs: [] } as never)
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

describe('the Position column', () => {
  const position = (n: number) => screen.getByRole('meter', { name: `SERVO${n} output` })

  it('draws what the output is driving, on the same 900-2100 scale as the Radio tab', () => {
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [1500] } as never)
    render(<OutputsTab />)
    expect(position(1).textContent).toBe('1500')
    const fill = position(1).querySelector<HTMLElement>('.servo-position__fill')
    expect(fill?.style.width).toBe('50%')
  })

  it('draws nothing on an output ArduPilot reports as 0, and says so with a dash', () => {
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [0] } as never)
    render(<OutputsTab />)
    expect(position(1).textContent).toBe('—')
    expect(position(1).querySelector('.servo-position__fill')).toBeNull()
  })

  it('is a reading, not a field', () => {
    // The row's other numbers are inputs; this one must not look like one,
    // and must not be one either.
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [1500] } as never)
    render(<OutputsTab />)
    expect(position(1).querySelector('input')).toBeNull()
    expect(position(1).tagName).not.toBe('INPUT')
  })
})

describe('Set trim', () => {
  const setTrim = (n: number) =>
    screen.getByRole('button', { name: `Set SERVO${n}_TRIM to the current position` }) as HTMLButtonElement

  it('writes the live position into that output’s trim', async () => {
    setParamNow.mockReset().mockImplementation(async (_n, v) => v)
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [1560] } as never)
    render(<OutputsTab />)
    expect(setTrim(1).disabled).toBe(false)
    fireEvent.click(setTrim(1))
    expect(setParamNow).toHaveBeenCalledWith('SERVO1_TRIM', 1560)
    // Staged on the way past, so the Trim box shows it before the ack.
    expect(useParamStore.getState().entries.get('SERVO1_TRIM')?.value).toBe(1560)
    await waitFor(() => expect(setParamNow).toHaveBeenCalledTimes(1))
  })

  it('has nothing to take from an output reporting nothing, and says so', () => {
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [0] } as never)
    render(<OutputsTab />)
    expect(setTrim(1).disabled).toBe(true)
    expect(setTrim(1).title).toBe('Nothing on this output')
  })

  it('will not make a trim outside the output’s travel, and says so', () => {
    // A disarmed motor at MOT_PWM_MIN, below this servo's own Min.
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [1000] } as never)
    render(<OutputsTab />)
    expect(setTrim(1).disabled).toBe(true)
    expect(setTrim(1).title).toMatch(/1000 is outside/)
  })

  it('is spent once the trim is already there, and says so', () => {
    seed(OUTPUTS)
    useVehicleStore.setState({ servoOutputsUs: [1500] } as never)
    render(<OutputsTab />)
    expect(setTrim(1).disabled).toBe(true)
    expect(setTrim(1).title).toBe('SERVO1_TRIM is already 1500')
  })
})
