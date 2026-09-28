import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import VehicleParamActions from '../../components/VehicleParamActions'
import { useParamStore } from '../../../stores/param-store'
import { useConnectionStore } from '../../../stores/connection-store'
import type { ParamRecord } from '../../../protocol/types'

// A parameter file is a document, not an aircraft. As in Mission Planner,
// it can be edited offline, and the buttons that need a vehicle (Write,
// Reload) are disabled for it.

const rec = (name: string, value: number): ParamRecord => ({ name, value, mavType: 9 })
const btn = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

/**
 * A stand-in for a picked file. jsdom has no `Blob.prototype.text()`, so a
 * real `File` would reject inside the handler. The handler only reads the
 * name and text.
 */
function pickedFile(name: string, text: string) {
  return { name, text: () => Promise.resolve(text) }
}

/**
 * The column has two hidden file inputs, Compare's and Import's, in that
 * order. This picks Import's.
 */
function importInput(): HTMLInputElement {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type=file]')]
  expect(inputs).toHaveLength(2)
  return inputs[1]!
}

beforeEach(() => {
  useParamStore.getState().reset()
  useConnectionStore.setState({ phase: 'idle' })
})
afterEach(() => {
  cleanup()
  useConnectionStore.setState({ phase: 'idle' })
})

describe('parameters opened from a file', () => {
  it('is marked as a file, not as a vehicle', () => {
    useParamStore.getState().loadedFile([rec('ATC_RAT_PIT_P', 0.135)], 'quad.param')
    const s = useParamStore.getState()
    expect(s.source).toBe('file')
    expect(s.fileName).toBe('quad.param')
    expect(s.loadState).toBe('ready')
  })

  it('will not offer to write a file to a vehicle that is not there', () => {
    useParamStore.getState().loadedFile([rec('ATC_RAT_PIT_P', 0.135)], 'quad.param')
    useParamStore.getState().edit('ATC_RAT_PIT_P', 0.2)
    // There is a staged edit, so Write is disabled only for lack of a vehicle.
    expect(useParamStore.getState().dirtyCount).toBe(1)
    render(<VehicleParamActions />)
    expect(btn(/^Write/).disabled).toBe(true)
    expect(btn(/Reload from vehicle/).disabled).toBe(true)
    // Reverting an edit to a file is still an edit to a file.
    expect(btn(/^Revert$/).disabled).toBe(false)
    expect(screen.getByText(/Connect a vehicle to write these/)).toBeTruthy()
  })

  it('still refuses once a vehicle arrives, while the file is what is shown', () => {
    // Connecting does not turn a file into the vehicle's set, so Write stays
    // disabled.
    useParamStore.getState().loadedFile([rec('ATC_RAT_PIT_P', 0.135)], 'quad.param')
    useParamStore.getState().edit('ATC_RAT_PIT_P', 0.2)
    useConnectionStore.setState({ phase: 'connected' })
    render(<VehicleParamActions />)
    expect(btn(/^Write/).disabled).toBe(true)
  })

  it('offers both once the set came from the vehicle', () => {
    useParamStore.getState().loaded([rec('ATC_RAT_PIT_P', 0.135)])
    useParamStore.getState().edit('ATC_RAT_PIT_P', 0.2)
    useConnectionStore.setState({ phase: 'connected' })
    render(<VehicleParamActions />)
    expect(useParamStore.getState().source).toBe('vehicle')
    expect(btn(/^Write/).disabled).toBe(false)
    expect(btn(/Reload from vehicle/).disabled).toBe(false)
  })
})

describe('importing with nothing loaded', () => {
  it('opens the file as the set rather than staging nothing against it', async () => {
    // Import stages differences against what is on screen. With an empty
    // table there is nothing to diff against, so the file is opened instead.
    const { default: ParamSidebar } = await import('./ParamSidebar')
    render(<ParamSidebar />)
    expect(useParamStore.getState().order).toHaveLength(0)

    const file = pickedFile('saved.param', 'ATC_RAT_PIT_P,0.135\nOSD_TYPE,1\n')
    const input = importInput()
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    await vi.waitFor(() => expect(useParamStore.getState().order).toHaveLength(2))
    const s = useParamStore.getState()
    expect(s.source).toBe('file')
    expect(s.fileName).toBe('saved.param')
    expect(s.entries.get('ATC_RAT_PIT_P')?.value).toBeCloseTo(0.135)
    // Opened, not staged: there is nothing to have changed from.
    expect(s.dirtyCount).toBe(0)
  })

  it('still stages differences once a set is loaded', async () => {
    useParamStore.getState().loaded([rec('ATC_RAT_PIT_P', 0.1)])
    const { default: ParamSidebar } = await import('./ParamSidebar')
    render(<ParamSidebar />)

    const file = pickedFile('other.param', 'ATC_RAT_PIT_P,0.135\n')
    const input = importInput()
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.change(input)

    await vi.waitFor(() => expect(useParamStore.getState().dirtyCount).toBe(1))
    // The vehicle's set is still the vehicle's; the file only staged an edit.
    expect(useParamStore.getState().source).toBe('vehicle')
    expect(useParamStore.getState().entries.get('ATC_RAT_PIT_P')?.origValue).toBeCloseTo(0.1)
  })
})
