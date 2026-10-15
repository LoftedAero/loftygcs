import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppStatus from './AppStatus'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useParamStore } from '../../stores/param-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'
import { SENSOR_BITS } from '../../protocol/sensors'
import { EKF_FLAGS } from '../../protocol/estimator'

// The EKF pill, first in the app bar's vehicle status: drawn only with a
// vehicle, and colored only by the vehicle's own signals.

const vehicle = (patch: Record<string, unknown> = {}) =>
  act(() => {
    useConnectionStore.setState({ phase: 'connected', error: null })
    useVehicleStore.setState({
      present: true,
      systemStatus: 3,
      sensorsPresent: SENSOR_BITS.ahrs,
      sensorsHealth: SENSOR_BITS.ahrs,
      ...patch,
    })
  })

const chip = () => screen.getByRole('button', { name: /^EKF status/ })
const tone = () => chip().className.match(/app-status__state--(\w+)/)?.[1]

beforeEach(() => {
  useVehicleStore.getState().reset()
  useParamStore.getState().reset()
  useParamStore.getState().loaded([{ name: 'AHRS_EKF_TYPE', value: 3, mavType: 2 }])
  useUiStore.setState({ estimatorOpen: false })
})
afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})

describe('the EKF pill', () => {
  it('is not drawn with no vehicle', () => {
    render(<AppStatus />)
    expect(screen.queryByRole('button', { name: /^EKF status/ })).toBeNull()
  })

  it('comes before the readiness pill', () => {
    render(<AppStatus />)
    vehicle()
    const row = screen.getByRole('group', { name: 'Vehicle status' })
    expect(row.firstElementChild).toBe(chip())
  })

  it('names the configured EKF in green while healthy', () => {
    render(<AppStatus />)
    vehicle()
    expect(chip().textContent).toBe('EKF3')
    expect(tone()).toBe('ok')
  })

  it('names the announced fallback in red', () => {
    render(<AppStatus />)
    vehicle({ sensorsHealth: 0, estimatorAnnounced: 'DCM' })
    expect(chip().textContent).toBe('DCM')
    expect(tone()).toBe('bad')
  })

  it('goes red during an EKF failsafe only while the heartbeat still says failsafe', () => {
    render(<AppStatus />)
    vehicle({ ekfFailsafe: true, systemStatus: 5 })
    expect(tone()).toBe('bad')
    vehicle({ ekfFailsafe: true, systemStatus: 3 })
    expect(tone()).toBe('ok')
  })

  it('is amber when the EKF reports GPS glitching', () => {
    render(<AppStatus />)
    vehicle({
      ekf: {
        flags: EKF_FLAGS.attitude | EKF_FLAGS.gpsGlitching,
        velocityVariance: 0,
        posHorizVariance: 0,
        posVertVariance: 0,
        compassVariance: 0,
        terrainAltVariance: 0,
        airspeedVariance: 0,
      },
    })
    expect(tone()).toBe('warn')
  })

  it('opens and closes the EKF window, and shows that it is open', () => {
    render(<AppStatus />)
    vehicle()
    fireEvent.click(chip())
    expect(useUiStore.getState().estimatorOpen).toBe(true)
    expect(chip().getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(chip())
    expect(useUiStore.getState().estimatorOpen).toBe(false)
  })
})
