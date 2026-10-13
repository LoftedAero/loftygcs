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

const vehicle = (ready: boolean, reasons: string[] = []) =>
  act(() => {
    useConnectionStore.setState({ phase: 'connected', error: null })
    useVehicleStore.setState({
      present: true,
      armed: false,
      vehicleType: 2, // quadrotor
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
  useVehicleStore.getState().reset()
  useParamStore.getState().reset()
  useParamStore.getState().loaded([{ name: 'ARMING_SKIPCHK', value: 1 << 16, mavType: 6 }])
  runCommand = vi.spyOn(connectionService, 'runCommand').mockResolvedValue(0)
})
afterEach(() => {
  cleanup()
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

  it('reads a dash, not a pass, before any reason is heard', () => {
    vehicle(false)
    render(<PreflightPanel />)
    expect(within(row('Compass')).getByText('-')).toBeTruthy()
  })

  it('does not fail a check beside "Ready to arm" for a reason sent before', () => {
    vehicle(true, ['Battery 1 below minimum arming voltage'])
    render(<PreflightPanel />)
    expect(within(row('Battery Level')).getByText('Pass')).toBeTruthy()
  })
})
