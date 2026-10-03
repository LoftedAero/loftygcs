import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import CompactStatus from './CompactStatus'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useConnectionStore } from '../../stores/connection-store'

const SILENT =
  'No heartbeat received. Check the connection settings, and that the board is running ArduPilot.'

beforeEach(() => {
  useVehicleStore.getState().reset()
  useConnectionStore.setState({ phase: 'idle', error: null, linkStats: null })
})
afterEach(() => {
  cleanup()
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
})
