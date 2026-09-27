import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NeedsVehicle } from './ParamCard'
import { useConnectionStore } from '../../stores/connection-store'
import { useParamStore } from '../../stores/param-store'

// The placeholder a vehicle-only tab draws. A reboot keeps the user on the
// tab (see `holdsVehicleTabs`), so this shows while the vehicle comes back.
// No vehicle, rebooting, and parameters still downloading each say something
// different; the last keeps tabs from drawing cards from a half-loaded set.

afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle' })
  useParamStore.setState({ loadState: 'idle' } as never)
})

describe('the card a tab shows without a vehicle', () => {
  it('asks for a vehicle when there is none', () => {
    render(<NeedsVehicle title="Sensors" />)
    expect(screen.queryByText(/Connect a vehicle/)).not.toBeNull()
  })

  it('says what is happening during a reboot, and asks for nothing', () => {
    useConnectionStore.setState({ phase: 'rebooting' })
    render(<NeedsVehicle title="Sensors" />)
    expect(screen.queryByText(/Rebooting the vehicle/)).not.toBeNull()
    // Nobody has to reconnect: the app does it.
    expect(screen.queryByText(/Connect a vehicle/)).toBeNull()
  })

  it('says the parameters are still coming, once the link is back', () => {
    useConnectionStore.setState({ phase: 'connected' })
    useParamStore.setState({ loadState: 'downloading' } as never)
    render(<NeedsVehicle title="Outputs" />)
    expect(screen.queryByText(/Reading the vehicle/)).not.toBeNull()
    // Neither of the other two: there is a vehicle, and it is not rebooting.
    expect(screen.queryByText(/Connect a vehicle/)).toBeNull()
    expect(screen.queryByText(/Rebooting the vehicle/)).toBeNull()
  })

  it('still asks for a vehicle when there is none, whatever the load state', () => {
    useParamStore.setState({ loadState: 'downloading' } as never)
    render(<NeedsVehicle title="Outputs" />)
    expect(screen.queryByText(/Connect a vehicle/)).not.toBeNull()
  })
})
