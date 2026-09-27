import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import FirmwareTab from './FirmwareTab'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { MAV_STATE } from '../flight/hud-draw'

// Detecting a board reboots it into its bootloader, which in flight stops the
// aircraft. These tests pin the states where Detect must be refused.

const setVehicle = (patch: Record<string, unknown>) =>
  act(() => {
    useConnectionStore.setState({ phase: 'connected', error: null })
    useVehicleStore.setState({
      present: true,
      armed: false,
      systemStatus: MAV_STATE.standby,
      ...patch,
    })
  })

const detectButton = () => screen.getByRole('button', { name: 'Detect board' }) as HTMLButtonElement

afterEach(() => {
  cleanup()
  act(() => {
    useConnectionStore.setState({ phase: 'idle', error: null })
    useVehicleStore.setState({ present: false, armed: false, systemStatus: 0 })
  })
})

describe('detecting a board is refused while the vehicle is flying it', () => {
  it('refuses when armed, whether or not it has left the ground', () => {
    // An armed vehicle is one whose motors can turn.
    setVehicle({ armed: true, systemStatus: MAV_STATE.standby })
    render(<FirmwareTab />)
    expect(detectButton().disabled).toBe(true)
    expect(screen.getByText(/vehicle is armed/i)).toBeTruthy()
  })

  it('refuses while flying', () => {
    setVehicle({ systemStatus: MAV_STATE.active })
    render(<FirmwareTab />)
    expect(detectButton().disabled).toBe(true)
    expect(screen.getByText(/vehicle is flying/i)).toBeTruthy()
  })

  it('refuses during a failsafe', () => {
    // CRITICAL and EMERGENCY are ArduPilot's failsafe states.
    setVehicle({ systemStatus: MAV_STATE.critical })
    render(<FirmwareTab />)
    expect(detectButton().disabled).toBe(true)
    expect(screen.getByText(/failsafe/i)).toBeTruthy()
  })

  it('allows it on a vehicle sitting still, which is asked about rather than blocked', () => {
    // Connected and disarmed (the usual bench case) still reboots the
    // vehicle, so the button is live and a confirmation dialog asks first.
    setVehicle({ systemStatus: MAV_STATE.standby })
    render(<FirmwareTab />)
    expect(detectButton().disabled).toBe(false)
  })

  it('allows it with nothing connected at all', () => {
    render(<FirmwareTab />)
    expect(detectButton().disabled).toBe(false)
  })
})
