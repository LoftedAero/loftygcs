import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import AppStatus from './AppStatus'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useConnectionStore } from '../../stores/connection-store'
import { SENSOR_BITS } from '../../protocol/sensors'

// The bar draws nothing it cannot stand behind.
//
// This is the property the whole change rests on, and it is the one a
// screenshot cannot pin: the element this replaced always rendered, so it
// always had to say *something*, which is how a 691px box came to hold the
// words "Not connected". Both references remove their status instead --
// QGroundControl instantiates no vehicle indicators without a vehicle,
// Betaflight sets its cluster to `display: none`.

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
    // The reversal that matters. These were gated on the SYS_STATUS present
    // mask, so a flight controller with no GPS had no GPS reading at all --
    // which tells a pilot nothing and reads as a layout fault. "No GPS" is
    // the reading that decides whether the position modes can be flown.
    connected({ sensorsPresent: SENSOR_BITS.prearm, gpsFix: 0, gpsSats: 0 })
    render(<AppStatus />)
    expect(screen.getByText('No GPS')).toBeTruthy()
  })

  it('keeps the same set of readings whatever the vehicle carries', () => {
    // No battery monitor, no GPS, no RC. All four are still drawn, so the
    // row is one shape across aircraft rather than one per sensor fit.
    connected({ sensorsPresent: SENSOR_BITS.prearm, batteryV: 0, batteryPct: -1, rcRssi: -1 })
    const { container } = render(<AppStatus />)
    expect(container.querySelectorAll('.app-status__item')).toHaveLength(4)
  })

  it('shows a dash rather than a zero for a reading the vehicle has not made', () => {
    // 0.0V is what a monitor reading a dead pack shows too. A vehicle that
    // never reported one must not be drawn as one that did.
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
    // The chip routes to the preflight checks. With no vehicle there are
    // none, so it must not offer the trip.
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
