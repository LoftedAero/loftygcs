import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CompactStatus from './CompactStatus'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useUiStore } from '../../stores/ui-store'
import { connectionService } from '../../services/connection'

const SILENT =
  'No heartbeat received. Check the connection settings, and that the board is running ArduPilot.'

beforeEach(() => {
  useVehicleStore.getState().reset()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useUiStore.setState({ preflightOpen: false })
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})

describe('the compact bar status', () => {
  it('keeps a failed connection to a word, with the sentence a tap away', () => {
    // The sentence in the bar pushed it past a 732px window.
    act(() => useConnectionStore.setState({ phase: 'error', error: SILENT }))
    render(<CompactStatus />)
    expect(screen.queryByText(SILENT)).toBeNull()
    fireEvent.click(screen.getByText('No heartbeat'))
    expect(screen.getByText(SILENT)).toBeTruthy()
  })

  it("opens Preflight when asked from elsewhere, as the HUD's pill does, and closes it with the vehicle", () => {
    vi.spyOn(connectionService, 'runCommand').mockResolvedValue(0)
    act(() => {
      useConnectionStore.setState({ phase: 'connected', error: null })
      useVehicleStore.setState({ present: true })
    })
    render(<CompactStatus />)
    expect(screen.queryByRole('dialog', { name: 'Preflight' })).toBeNull()
    act(() => useUiStore.getState().setPreflightOpen(true))
    expect(screen.getByRole('dialog', { name: 'Preflight' })).toBeTruthy()
    // Otherwise it would open by itself with the next vehicle.
    act(() => useVehicleStore.setState({ present: false }))
    expect(useUiStore.getState().preflightOpen).toBe(false)
  })
})
