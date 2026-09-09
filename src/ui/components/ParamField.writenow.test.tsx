import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('sends the value and then re-reads in the background', async () => {
    render(<ParamField param="OSD_TYPE" label="OSD type" writeNow />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    await vi.waitFor(() => expect(refreshed.length).toBe(1))
    expect(sent).toEqual([['OSD_TYPE', 5]])
    // Quiet: a refresh nobody asked for must not blank the curated tabs.
    expect(refreshed[0]).toEqual({ quiet: true })
  })

  it('falls back to staging when the write does not land', async () => {
    // The value the user picked is still what they want, so it becomes a
    // staged edit and the action bar's Write is the honest state of it.
    writeFails = true
    render(<ParamField param="OSD_TYPE" label="OSD type" writeNow />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } })
    await vi.waitFor(() =>
      expect(useParamStore.getState().entries.get('OSD_TYPE')?.dirty).toBe(true),
    )
    expect(useParamStore.getState().entries.get('OSD_TYPE')?.value).toBe(1)
    expect(refreshed).toEqual([])
  })

  it('does not write while a number is being typed', () => {
    // "50" passes through 5 on the way. A field that wrote every keystroke
    // would send a value nobody chose.
    render(<ParamField param="OSD_MSG_TIME" label="Message time" writeNow />)
    const box = screen.getByRole('spinbutton')
    fireEvent.change(box, { target: { value: '5' } })
    fireEvent.change(box, { target: { value: '50' } })
    expect(sent).toEqual([])
    // It is staged, so the control shows what is being typed.
    expect(useParamStore.getState().entries.get('OSD_MSG_TIME')?.value).toBe(50)
  })

  it('sends a typed number once it is committed', async () => {
    render(<ParamField param="OSD_MSG_TIME" label="Message time" writeNow />)
    const box = screen.getByRole('spinbutton')
    fireEvent.change(box, { target: { value: '50' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await vi.waitFor(() => expect(sent).toEqual([['OSD_MSG_TIME', 50]]))
  })

  it('leaves an ordinary field staging, as every curated card does', async () => {
    render(<ParamField param="OSD_TYPE" label="OSD type" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5' } })
    expect(sent).toEqual([])
    expect(useParamStore.getState().entries.get('OSD_TYPE')?.dirty).toBe(true)
  })
})
