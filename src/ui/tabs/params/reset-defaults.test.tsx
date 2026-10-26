import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import ParamSidebar from './ParamSidebar'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { connectionService } from '../../../services/connection'

// Resetting every parameter erases calibrations too, so it is confirmed, never
// sent while armed, and followed by the reboot that loads the defaults.

const MAV_CMD_PREFLIGHT_STORAGE = 245
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246

let runCommand: MockInstance<typeof connectionService.runCommand>
const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const commands = () => runCommand.mock.calls.map((c) => [c[0], c[1]?.[0]])

beforeEach(() => {
  useParamStore.getState().reset()
  useParamStore.getState().loaded([{ name: 'ATC_RAT_PIT_P', value: 0.2, mavType: 9 }])
  useConnectionStore.setState({ phase: 'connected', error: null })
  useVehicleStore.setState({ present: true, armed: false })
  runCommand = vi.spyOn(connectionService, 'runCommand').mockResolvedValue(0)
  vi.spyOn(connectionService, 'expectReboot').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useConnectionStore.setState({ phase: 'idle', error: null })
  useVehicleStore.getState().reset()
})

describe('Reset to defaults', () => {
  it('erases, then reboots so the defaults load', async () => {
    render(<ParamSidebar />)
    fireEvent.click(btn('Reset to defaults'))
    expect(runCommand).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(btn('Reset and reboot')))
    expect(commands()).toEqual([
      [MAV_CMD_PREFLIGHT_STORAGE, 2],
      [MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, 1],
    ])
  })

  it('does not reboot when the autopilot refuses', async () => {
    runCommand.mockResolvedValue(4) // MAV_RESULT_FAILED
    render(<ParamSidebar />)
    fireEvent.click(btn('Reset to defaults'))
    await act(async () => fireEvent.click(btn('Reset and reboot')))
    expect(commands()).toEqual([[MAV_CMD_PREFLIGHT_STORAGE, 2]])
    expect(screen.getByText('The autopilot refused the reset.')).toBeTruthy()
  })

  it('is refused while armed, since ArduPilot would erase anyway', () => {
    useVehicleStore.setState({ armed: true })
    render(<ParamSidebar />)
    fireEvent.click(btn('Reset to defaults'))
    expect(btn('Reset and reboot').disabled).toBe(true)
  })

  it('is not offered for a parameter file', () => {
    useParamStore
      .getState()
      .loadedFile([{ name: 'ATC_RAT_PIT_P', value: 0.2, mavType: 9 }], 'a.param')
    render(<ParamSidebar />)
    expect(btn('Reset to defaults').disabled).toBe(true)
  })
})
