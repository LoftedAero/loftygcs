import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import ParamField from './ParamField'
import { useParamStore } from '../../stores/param-store'
import type { ParamRecord } from '../../protocol/types'

// A `writeNow` field sends on a deliberate commit, and never on a keystroke.

const sent: [string, number][] = []
const refreshed: { quiet?: boolean }[] = []
let writeFails = false

vi.mock('../../services/connection', () => ({
  connectionService: {
    setParamNow: (name: string, value: number) => {
      if (writeFails) return Promise.reject(new Error('not connected'))
      sent.push([name, value])
      return Promise.resolve(value)
    },
    refreshParams: (opts: { quiet?: boolean } = {}) => {
      refreshed.push(opts)
      return Promise.resolve()
    },
  },
}))

const rec = (name: string, value: number): ParamRecord => ({ name, value, mavType: 4 })

beforeEach(() => {
  sent.length = 0
  refreshed.length = 0
  writeFails = false
  useParamStore.getState().loaded([rec('OSD_TYPE', 0), rec('OSD_MSG_TIME', 10)])
  useParamStore
    .getState()
    .setMetadata({ OSD_TYPE: { values: { 0: 'None', 1: 'MAX7456', 5: 'MSP DisplayPort' } } }, null)
})
afterEach(cleanup)

describe('a field that writes as soon as it is chosen', () => {
  it('sends the value and then re-reads in the background, when it gates others', async () => {
    render(<ParamField param="OSD_TYPE" label="OSD type" writeNow gatesOthers />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    await vi.waitFor(() => expect(refreshed.length).toBe(1))
    expect(sent).toEqual([['OSD_TYPE', 5]])
    // Quiet, so the curated tabs do not blank.
    expect(refreshed[0]).toEqual({ quiet: true })
  })

  it('answers inside the field that wrote, and not in its neighbour', async () => {
    render(
      <>
        <div data-testid="type">
          <ParamField param="OSD_TYPE" label="OSD type" writeNow />
        </div>
        <div data-testid="time">
          <ParamField param="OSD_MSG_TIME" label="Message time" writeNow />
        </div>
      </>,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    // The field shows a tick; the words remain for assistive technology,
    // which is what this asserts on.
    await vi.waitFor(() =>
      expect(within(screen.getByTestId('type')).queryByText('OSD_TYPE saved.')).not.toBeNull(),
    )
    expect(screen.getByTestId('type').querySelector('.write-feedback__mark')).not.toBeNull()
    expect(within(screen.getByTestId('time')).queryByText('OSD_TYPE saved.')).toBeNull()
  })

  it('does NOT re-read for a field that only writes', async () => {
    // Writing immediately and gating other parameters are separate. A
    // refresh re-reads ~1,400 parameters, tens of seconds over a telemetry
    // radio.
    render(<ParamField param="OSD_TYPE" label="OSD type" writeNow />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    await vi.waitFor(() => expect(sent).toEqual([['OSD_TYPE', 5]]))
    expect(refreshed).toEqual([])
  })

  it('falls back to staging when the write does not land', async () => {
    // The chosen value survives as a staged edit.
    writeFails = true
    render(<ParamField param="OSD_TYPE" label="OSD type" writeNow />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    await vi.waitFor(() =>
      expect(useParamStore.getState().entries.get('OSD_TYPE')?.dirty).toBe(true),
    )
    expect(useParamStore.getState().entries.get('OSD_TYPE')?.value).toBe(1)
    expect(refreshed).toEqual([])
  })

  // A number box fires `input` on each keystroke and the native `change` on
  // commit: Enter, blur, or a stepper click (which fires both). React's
  // `onChange` is the input event, so `fireEvent.change` here is a commit,
  // not a keypress.
  it('does not write while a number is being typed', () => {
    // "50" passes through 5 on the way.
    render(<ParamField param="OSD_MSG_TIME" label="Message time" writeNow />)
    const box = screen.getByRole('spinbutton')
    fireEvent.input(box, { target: { value: '5' } })
    fireEvent.input(box, { target: { value: '50' } })
    expect(sent).toEqual([])
    // It is staged, so the control shows what is being typed.
    expect(useParamStore.getState().entries.get('OSD_MSG_TIME')?.value).toBe(50)
  })

  it('sends a typed number once it is committed', async () => {
    render(<ParamField param="OSD_MSG_TIME" label="Message time" writeNow />)
    const box = screen.getByRole('spinbutton')
    fireEvent.input(box, { target: { value: '50' } })
    expect(sent).toEqual([])
    fireEvent.change(box, { target: { value: '50' } })
    await vi.waitFor(() => expect(sent).toEqual([['OSD_MSG_TIME', 50]]))
  })

  it('sends a step from the stepper, without leaving the box', async () => {
    // Nudging a servo trim with the arrows must send each step.
    render(<ParamField param="OSD_MSG_TIME" label="Message time" writeNow />)
    const box = screen.getByRole('spinbutton')
    fireEvent.input(box, { target: { value: '11' } })
    fireEvent.change(box, { target: { value: '11' } })
    await vi.waitFor(() => expect(sent).toEqual([['OSD_MSG_TIME', 11]]))
  })

  it('leaves an ordinary field staging, as every curated card does', async () => {
    render(<ParamField param="OSD_TYPE" label="OSD type" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    expect(sent).toEqual([])
    expect(useParamStore.getState().entries.get('OSD_TYPE')?.dirty).toBe(true)
  })
})
