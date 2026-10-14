import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import PreflightPanel from './PreflightPanel'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { connectionService } from '../../../services/connection'
import { SENSOR_BITS } from '../../../protocol/sensors'

// The Preflight pane's list of ArduPilot's arming checks, each with a status.

const MAV_CMD_RUN_PREARM_CHECKS = 401

let runCommand: MockInstance<typeof connectionService.runCommand>

// The panel asks for checks at most every thirty seconds across mounts, so
// each test starts a minute after the last.
let clock = Date.parse('2026-01-01T00:00:00Z')

const vehicle = (ready: boolean, reasons: string[] = [], vehicleType = 2 /* quadrotor */) =>
  act(() => {
    useConnectionStore.setState({ phase: 'connected', error: null })
    useVehicleStore.setState({
      present: true,
      armed: false,
      vehicleType,
      sensorsPresent: SENSOR_BITS.prearm,
      sensorsHealth: ready ? SENSOR_BITS.prearm : 0,
      statusTexts: reasons.map((r) => ({ severity: 2, text: `PreArm: ${r}`, at: Date.now() })),
    })
  })

const row = (label: string) => {
  const name = screen.getByText(label, { selector: '.preflight__check-name' })
  return name.closest('li')!
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  clock += 60_000
  vi.setSystemTime(clock)
  useVehicleStore.getState().reset()
  useParamStore.getState().reset()
  useParamStore.getState().loaded([{ name: 'ARMING_SKIPCHK', value: 1 << 16, mavType: 6 }])
  runCommand = vi.spyOn(connectionService, 'runCommand').mockResolvedValue(0)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})

describe('the arming checks list', () => {
  it('passes every running check when the vehicle reports ready, and asks nothing', () => {
    vehicle(true)
    render(<PreflightPanel />)
    expect(within(row('Compass')).getByText('Pass')).toBeTruthy()
    expect(within(row('Camera')).getByText('Skipped')).toBeTruthy()
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('fails the check a reason belongs to, with the reason as its hover text', () => {
    vehicle(false, ['Battery 1 below minimum arming voltage'])
    render(<PreflightPanel />)
    const battery = row('Battery Level')
    expect(within(battery).getByText('Fail')).toBeTruthy()
    expect(battery.getAttribute('title')).toBe('Battery 1 below minimum arming voltage')
    expect(within(row('Compass')).getByText('Pass')).toBeTruthy()
  })

  it('asks the vehicle to run its checks when it is not ready', () => {
    vehicle(false)
    render(<PreflightPanel />)
    expect(runCommand).toHaveBeenCalledWith(MAV_CMD_RUN_PREARM_CHECKS, [], 2000)
  })

  it('asks at most every thirty seconds, however often it is opened', () => {
    vehicle(false)
    render(<PreflightPanel />)
    cleanup()
    render(<PreflightPanel />)
    expect(runCommand).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 30_000)
    cleanup()
    render(<PreflightPanel />)
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('asks again on a new connection, whatever the last one asked', () => {
    vehicle(false)
    render(<PreflightPanel />)
    cleanup()
    act(() => useConnectionStore.setState({ phase: 'opening' }))
    vehicle(false)
    render(<PreflightPanel />)
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('lists the reasons after the checks, so their coming and going never moves the grid', () => {
    vehicle(false, ['Compass not calibrated', 'Gyros inconsistent'])
    render(<PreflightPanel />)
    const sections = [...document.querySelectorAll('.preflight__head')].map((h) => h.textContent)
    expect(sections).toEqual(['Arming checks', 'Messages'])
    expect(screen.getByText('Gyros inconsistent')).toBeTruthy()
  })

  it('waits, rather than blaming the firmware, before the first sensor report', () => {
    vehicle(true)
    act(() => useVehicleStore.setState({ sensorsPresent: 0, sensorsHealth: 0 }))
    render(<PreflightPanel />)
    expect(screen.getByText('Waiting for the arming state…')).toBeTruthy()
  })

  it("lists a VTOL plane's checks as a plane's", () => {
    vehicle(true, [], 20) // MAV_TYPE_VTOL_QUADROTOR
    render(<PreflightPanel />)
    expect(row('Airspeed')).toBeTruthy()
    expect(screen.queryByText('VisualOdometry')).toBeNull()
  })

  it('reads a dash, not a pass, before any reason is heard', () => {
    vehicle(false)
    render(<PreflightPanel />)
    expect(within(row('Compass')).getByText('-')).toBeTruthy()
  })

  it('lists no reason from before beside "Ready to arm", but keeps a refused attempt', () => {
    vehicle(true, ['Compass not calibrated'])
    render(<PreflightPanel />)
    expect(screen.getByText('Ready to arm')).toBeTruthy()
    expect(screen.queryByText('Compass not calibrated')).toBeNull()
    cleanup()
    act(() =>
      useVehicleStore.setState({
        statusTexts: [{ severity: 2, text: 'Arm: Throttle too high', at: Date.now() }],
      }),
    )
    render(<PreflightPanel />)
    expect(screen.getByText('Throttle too high')).toBeTruthy()
  })

  it('does not fail a check beside "Ready to arm" for a reason sent before', () => {
    vehicle(true, ['Battery 1 below minimum arming voltage'])
    render(<PreflightPanel />)
    expect(within(row('Battery Level')).getByText('Pass')).toBeTruthy()
  })
})
