import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import AppStatus from './AppStatus'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useConnectionStore } from '../../stores/connection-store'
import { SENSOR_BITS } from '../../protocol/sensors'

// With no vehicle the status row is not drawn at all, as in QGroundControl
// and Betaflight.

const connected = (patch: Record<string, unknown> = {}) =>
  act(() => {
    useConnectionStore.setState({ phase: 'connected', error: null })
    useVehicleStore.setState({
      present: true,
      armed: false,
      systemStatus: 4,
      modeName: 'Loiter',
      sensorsPresent: SENSOR_BITS.prearm,
      sensorsHealth: SENSOR_BITS.prearm,
      ...patch,
    })
  })

beforeEach(() => {
  useVehicleStore.getState().reset()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})
afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})

describe('the app bar status row', () => {
  it('renders nothing at all with no connection', () => {
    const { container } = render(<AppStatus />)
    expect(container.innerHTML).toBe('')
  })

  it('draws GPS even on a vehicle that has none', () => {
    // Not gated on the SYS_STATUS present mask: "No GPS" is itself a reading,
    // and it decides whether the position modes can be flown.
    connected({ sensorsPresent: SENSOR_BITS.prearm, gpsFix: 0, gpsSats: 0 })
    render(<AppStatus />)
    expect(screen.getByText('No GPS')).toBeTruthy()
  })

  it('keeps the same set of readings whatever the vehicle carries', () => {
    // No battery monitor, no GPS, no RC. All five are still drawn.
    connected({ sensorsPresent: SENSOR_BITS.prearm, batteryV: 0, batteryPct: -1, rcRssi: -1 })
    const { container } = render(<AppStatus />)
    expect(container.querySelectorAll('.app-status__item')).toHaveLength(5)
  })

  it('draws the firmware slot before the vehicle has reported a version', () => {
    // AUTOPILOT_VERSION arrives after the heartbeat. The slot holds a dash
    // until then so the gauges do not shift.
    connected({ sensorsPresent: SENSOR_BITS.prearm })
    const { container } = render(<AppStatus />)
    const fw = container.querySelector('.app-status__item--firmware .app-status__val')
    expect(fw?.textContent).toBe('—')
  })

  it('shows a dash rather than a zero for a reading the vehicle has not made', () => {
    // A value never reported is a dash, not 0.0V (a dead pack).
    connected({ sensorsPresent: SENSOR_BITS.prearm, batteryV: 0, batteryA: 0, batteryPct: -1 })
    const { container } = render(<AppStatus />)
    const battery = container.querySelector('.app-status__item--battery .app-status__val')
    expect(battery?.textContent).toBe('—')
  })

  it('shows the battery once the vehicle says it has a monitor', () => {
    connected({
      sensorsPresent: SENSOR_BITS.prearm | SENSOR_BITS.battery,
      sensorsHealth: SENSOR_BITS.prearm | SENSOR_BITS.battery,
      batteryV: 12.4,
      batteryPct: 78,
    })
    render(<AppStatus />)
    expect(screen.getByText(/12\.4V/)).toBeTruthy()
  })

  it('is only a button when there is a vehicle to explain', () => {
    // The chip links to the preflight checks, which need a vehicle.
    act(() => useConnectionStore.setState({ phase: 'handshaking' }))
    const { container, rerender } = render(<AppStatus />)
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByText('Waiting for heartbeat')).toBeTruthy()

    connected()
    rerender(<AppStatus />)
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('keeps a failed connection visible', () => {
    act(() =>
      useConnectionStore.setState({ phase: 'error', error: 'connect ECONNREFUSED 127.0.0.1:5760' }),
    )
    render(<AppStatus />)
    expect(screen.getByText('connect ECONNREFUSED 127.0.0.1:5760')).toBeTruthy()
  })
})
