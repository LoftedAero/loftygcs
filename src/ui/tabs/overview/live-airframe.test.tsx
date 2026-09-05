import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useVehicleStore } from '../../../stores/vehicle-store'

// The live half of the airframe easter egg: a boot banner has to reach the
// model the Overview draws. The store latch and the frame matcher have
// their own tests; what this covers is the wiring between them and the
// view, which is the part that silently does nothing when a prop is
// forgotten.
//
// VehicleView itself is replaced: it builds a WebGL scene and loads a glTF,
// neither of which jsdom has, and the question here is only which airframe
// it was handed.

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
  // The panel's instruments draw to canvases jsdom does not implement; the
  // noise is not the subject here.
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement['getContext']
})
afterEach(() => cleanup())

const boot = (text: string) =>
  act(() => useVehicleStore.getState().appendStatusText({ severity: 6, text, at: 0 }))

/** The credit paragraph, and whether it is on screen at all. */
const creditHidden = () => screen.getByText(/Aircraft model/i).closest('p')!.hidden

describe('the Overview airframe', () => {
  it('draws the stock model when the vehicle never said what it is', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    render(<LiveVehiclePanel />)
    expect(screen.getByTestId('vehicle-view').getAttribute('data-airframe')).toBe('none')
    // And the biplane's CC-BY credit is on screen, because the biplane is
    // what a plane gets drawn as.
    expect(creditHidden()).toBe(false)
  })

  it('draws the F-35B once the vehicle announces itself', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    // The line 4.2.2 sends; 4.6.3 words it differently and both are covered
    // in the matcher's own tests.
    boot('QuadPlane Frame: F-35B')
    render(<LiveVehiclePanel />)
    expect(screen.getByTestId('vehicle-view').getAttribute('data-airframe')).toBe('f35b')
  })

  it('drops the biplane credit when the biplane is not drawn', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    boot('QuadPlane initialised, Frame: F-35B')
    render(<LiveVehiclePanel />)
    // CC-BY requires the credit to travel with the model. It must not
    // travel with a model it does not cover.
    expect(creditHidden()).toBe(true)
  })

  it('picks the airframe up mid-session, not only at mount', async () => {
    const { default: LiveVehiclePanel } = await import('./LiveVehiclePanel')
    render(<LiveVehiclePanel />)
    expect(seen.at(-1)?.airframe ?? null).toBeNull()
    // The banner arrives after the panel is already on screen, which is the
    // ordinary case: the vehicle connects and then introduces itself.
    boot('QuadPlane Frame: F-35B')
    expect(seen.at(-1)?.airframe).toBe('f35b')
  })
})
