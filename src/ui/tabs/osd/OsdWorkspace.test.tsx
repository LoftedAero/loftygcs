import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import OsdWorkspace from './OsdWorkspace'
import { useParamStore } from '../../../stores/param-store'

// The OSD page draws itself with the OSD switched off.
//
// It used to return one card reading "This firmware exposes no panel
// parameters", which replaced the entire workspace -- including the column
// holding the Display card, where OSD_TYPE is edited. The state hid its own
// fix, and the only way out was the Parameters table.

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
    // A vehicle reporting OSD_TYPE and nothing else: no panel positions at
    // all, which is the case that used to blank the page.
    seed({ OSD_TYPE: 0 })
    const { container } = render(<OsdWorkspace />)
    expect(container.querySelector('.osd-workspace')).toBeTruthy()
    // The screen preview is still there to look at.
    expect(screen.getByText('Screen layout')).toBeTruthy()
  })

  it('keeps the control that turns the OSD on reachable', () => {
    // The point of the whole change. OSD_TYPE is edited from the Display
    // card, which lives in the workspace's own column -- so blanking the
    // workspace took the only way out of this state with it.
    seed({ OSD_TYPE: 0 })
    render(<OsdWorkspace />)
    expect(screen.getByText('OSD type')).toBeTruthy()
  })

  it('disables what cannot be edited yet', () => {
    // Panel positions exist but the backend is off, so the layout is
    // readable and not editable -- staging a move would write a parameter
    // the vehicle is not drawing from.
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
