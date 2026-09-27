import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'

// A boot banner has to reach the model the Overview draws. The store latch and
// frame matcher have their own tests; this covers the wiring to the view.
//
// VehicleView is mocked: it needs WebGL, which jsdom lacks, and the question
// here is only which airframe it is handed.

const seen: { vehicle?: string; airframe?: string | null | undefined }[] = []

vi.mock('../../components/VehicleView', () => ({
  default: (props: { vehicle: string; airframe?: string | null }) => {
    seen.push({ vehicle: props.vehicle, airframe: props.airframe })
    return <div data-testid="vehicle-view" data-airframe={props.airframe ?? 'none'} />
  },
}))

beforeEach(() => {
  seen.length = 0
  useVehicleStore.getState().reset()
  // The panel draws no model without a vehicle.
  useConnectionStore.setState({ phase: 'connected' })
  // jsdom has no canvas; silence the instruments.
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement['getContext']
})
afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle' })
})

const boot = (text: string) =>
  act(() => useVehicleStore.getState().appendStatusText({ severity: 6, text, at: 0 }))

/** The credit paragraph, and whether it is on screen at all. */
const creditHidden = () => screen.getByText(/Aircraft model/i).closest('p')!.hidden

describe('the Overview airframe', () => {
  it('draws the stock model when the vehicle never said what it is', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    render(<LiveVehiclePanel />)
    expect(screen.getByTestId('vehicle-view').getAttribute('data-airframe')).toBe('none')
    // The stock model is the biplane, so its CC-BY credit is shown.
    expect(creditHidden()).toBe(false)
  })

  it('draws the F-35B once the vehicle announces itself', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    // 4.2.2's wording; the matcher's tests cover 4.6.3's as well.
    boot('QuadPlane Frame: F-35B')
    render(<LiveVehiclePanel />)
    expect(screen.getByTestId('vehicle-view').getAttribute('data-airframe')).toBe('f35b')
  })

  it('drops the biplane credit when the biplane is not drawn', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    boot('QuadPlane initialised, Frame: F-35B')
    render(<LiveVehiclePanel />)
    // The CC-BY credit belongs with the biplane only.
    expect(creditHidden()).toBe(true)
  })

  it('draws no model, and no credit, with nothing connected', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    useConnectionStore.setState({ phase: 'idle' })
    render(<LiveVehiclePanel />)
    // The well stays so the card does not resize on connect, but it is empty.
    expect(screen.queryByTestId('vehicle-view')).toBeNull()
    expect(creditHidden()).toBe(true)
  })

  it('picks the airframe up mid-session, not only at mount', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    render(<LiveVehiclePanel />)
    expect(seen.at(-1)?.airframe ?? null).toBeNull()
    // The usual order: the panel is up before the banner arrives.
    boot('QuadPlane Frame: F-35B')
    expect(seen.at(-1)?.airframe).toBe('f35b')
  })
})
