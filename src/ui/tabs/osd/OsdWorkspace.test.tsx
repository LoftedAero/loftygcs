import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import OsdWorkspace from './OsdWorkspace'
import { useParamStore } from '../../../stores/param-store'

const setParamNow = vi.fn<(name: string, value: number) => Promise<number>>(async (_n, v) => v)
const refreshParams = vi.fn<(opts: { quiet?: boolean }) => Promise<void>>(async () => {})
vi.mock('../../../services/connection', () => ({
  connectionService: {
    setParamNow: (name: string, value: number) => setParamNow(name, value),
    refreshParams: (opts: { quiet?: boolean }) => refreshParams(opts),
  },
}))

// The OSD page renders with the OSD switched off, keeping the Display card
// (where OSD_TYPE is edited) reachable.

const entry = (value: number) => ({ value, origValue: value, mavType: 4, dirty: false })

function seed(params: Record<string, number>) {
  useParamStore.setState({
    entries: new Map(Object.entries(params).map(([k, v]) => [k, entry(v)])),
  })
}

afterEach(() => {
  cleanup()
  useParamStore.setState({ entries: new Map() })
})

describe('the OSD page with the OSD off', () => {
  it('still renders the workspace', () => {
    // A vehicle reporting OSD_TYPE and no panel positions at all.
    seed({ OSD_TYPE: 0 })
    const { container } = render(<OsdWorkspace />)
    expect(container.querySelector('.osd-workspace')).toBeTruthy()
    // The screen preview is still there to look at.
    expect(screen.getByText('Screen layout')).toBeTruthy()
  })

  it('keeps the control that turns the OSD on reachable', () => {
    // OSD_TYPE is edited from the Display card in the workspace's column.
    seed({ OSD_TYPE: 0 })
    render(<OsdWorkspace />)
    expect(screen.getByText('OSD type')).toBeTruthy()
  })

  it('disables what cannot be edited yet', () => {
    // Panel positions exist but the backend is off, so the layout is
    // read-only.
    seed({
      OSD_TYPE: 0,
      OSD1_ENABLE: 1,
      OSD1_ALTITUDE_EN: 1,
      OSD1_ALTITUDE_X: 1,
      OSD1_ALTITUDE_Y: 1,
    })
    const { container } = render(<OsdWorkspace />)
    const switches = [...container.querySelectorAll('.la-switch input')]
    expect(switches.length).toBeGreaterThan(0)
    expect(switches.every((s) => (s as HTMLInputElement).disabled)).toBe(true)
  })

  it('leaves them editable once the OSD is on', () => {
    seed({
      OSD_TYPE: 1,
      OSD1_ENABLE: 1,
      OSD1_ALTITUDE_EN: 1,
      OSD1_ALTITUDE_X: 1,
      OSD1_ALTITUDE_Y: 1,
    })
    const { container } = render(<OsdWorkspace />)
    const switches = [...container.querySelectorAll('.la-switch input')]
    expect(switches.length).toBeGreaterThan(0)
    expect(switches.some((s) => !(s as HTMLInputElement).disabled)).toBe(true)
  })
})

describe('a screen that is off', () => {
  // What ArduPlane 4.7.1 reports for a screen with OSD2_ENABLE at 0: no panel
  // parameters except Link quality's, which sits outside the table the enable
  // hides.
  const OFF_SCREEN = {
    OSD_TYPE: 1,
    OSD1_ENABLE: 0,
    OSD1_LINK_Q_EN: 0,
    OSD1_LINK_Q_X: 1,
    OSD1_LINK_Q_Y: 1,
    OSD1_ESC_IDX: 0,
  }

  it('offers no lone Link quality toggle, and says what to do', () => {
    seed(OFF_SCREEN)
    render(<OsdWorkspace />)
    expect(screen.queryByText('Link quality')).toBeNull()
    expect(screen.getByText('Enable screen 1 to configure.')).toBeTruthy()
  })

  it('writes the screen enable from beside the picker, then re-reads', async () => {
    setParamNow.mockClear()
    refreshParams.mockClear()
    seed(OFF_SCREEN)
    const { container } = render(<OsdWorkspace />)
    const toggle = container.querySelector('.osd-toolbar__enable input') as HTMLInputElement
    expect(toggle.closest('.la-radio-group')).toBeTruthy()
    fireEvent.click(toggle)
    expect(setParamNow).toHaveBeenCalledWith('OSD1_ENABLE', 1)
    await waitFor(() => expect(refreshParams).toHaveBeenCalledWith({ quiet: true }))
  })
})

describe("a screen's own settings", () => {
  it('sit behind Configure, in a dialog with the screen in its title', () => {
    seed({
      OSD_TYPE: 1,
      OSD1_ENABLE: 1,
      OSD1_CHAN_MIN: 900,
      OSD1_CHAN_MAX: 2100,
      OSD1_ESC_IDX: 0,
      OSD1_FONT: 0,
    })
    render(<OsdWorkspace />)
    // In the dialog, not the column.
    expect(screen.queryByText('OSD1_CHAN_MIN')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }))
    // The column row and the dialog's title say the same thing.
    const dialog = [...document.querySelectorAll('.la-modal')].find((m) =>
      m.textContent?.startsWith('Screen 1 settings'),
    )!
    expect(dialog).toBeTruthy()
    for (const name of ['OSD1_CHAN_MIN', 'OSD1_CHAN_MAX', 'OSD1_ESC_IDX']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // The font is MSP DisplayPort's alone.
    expect(screen.queryByText('OSD1_FONT')).toBeNull()
    expect([...dialog.querySelectorAll('button')].some((b) => b.textContent === 'Close')).toBe(true)
  })
})

describe('the grid', () => {
  // ArduPilot draws the HD grids only over MSP DisplayPort.
  const LAYOUT = {
    OSD1_ENABLE: 1,
    OSD1_TXT_RES: 0,
    OSD1_ALTITUDE_EN: 1,
    OSD1_ALTITUDE_X: 1,
    OSD1_ALTITUDE_Y: 1,
  }

  it('is a readout, not a choice, on an analog OSD', () => {
    seed({ OSD_TYPE: 1, ...LAYOUT })
    const { container } = render(<OsdWorkspace />)
    expect(container.querySelector('.osd-toolbar__res select')).toBeNull()
    expect(container.querySelector('.osd-toolbar__res')?.textContent).toContain('SD 30×16')
  })

  it('is a choice on MSP DisplayPort', () => {
    seed({ OSD_TYPE: 5, ...LAYOUT })
    const { container } = render(<OsdWorkspace />)
    expect(container.querySelector('.osd-toolbar__res select')).toBeTruthy()
  })
})
