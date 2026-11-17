import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import FirmwareTab from './FirmwareTab'
import { boardsIn, parseRelease } from '../../../protocol/lofted-boards'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { MAV_STATE } from '../flight/hud-draw'

// Detecting a board reboots it into its bootloader, which in flight stops the
// aircraft. These tests pin the states where Detect must be refused.

const SHA = 'a'.repeat(64)
const LOFTED = boardsIn([
  parseRelease('r1', {
    format: 1,
    version: '1',
    date: '2026-11-13',
    boards: [
      {
        id: 'f405-srx',
        name: 'F405-SRX',
        boardId: 5999,
        firmware: [
          {
            id: 'stabrx',
            name: 'StabRX',
            file: 'a.apj',
            size: 1,
            sha256: SHA,
            withBootloader: { file: 'a.hex', size: 1, sha256: SHA },
            passthroughProtocol: 28,
          },
        ],
      },
    ],
  }),
])
vi.mock('../../../services/lofted-catalog', () => ({
  catalog: () => Promise.resolve(LOFTED),
}))

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
    useVehicleStore.setState({ present: false, armed: false, systemStatus: 0, boardId: 0 })
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

describe('a Lofted Aero board ArduPilot has no builds for', () => {
  it('is sent to the card that has its firmware', async () => {
    setVehicle({ boardId: 5999 })
    render(<FirmwareTab />)
    expect(
      await screen.findByText('F405-SRX firmware is on the Lofted Aero Flight Controllers card.'),
    ).toBeTruthy()
  })

  it('says nothing of the kind for any other board', async () => {
    setVehicle({ boardId: 140 })
    render(<FirmwareTab />)
    // Let the catalog arrive before looking.
    await act(async () => {})
    expect(screen.queryByText(/Lofted Aero Flight Controllers card/)).toBeNull()
  })
})
