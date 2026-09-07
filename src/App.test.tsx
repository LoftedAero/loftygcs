import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import App from './App'
import AppBar from './ui/shell/AppBar'
import { MODES, TABS, useUiStore } from './stores/ui-store'

// Testing Library only auto-cleans between tests when the runner exposes
// globals; we keep globals off, so unmount explicitly.
afterEach(cleanup)
beforeEach(() => useUiStore.setState({ mode: 'setup', activeTab: 'overview' }))

describe('app shell', () => {
  it('renders every setup section in the rail and switches between them', () => {
    render(<App />)
    for (const tab of TABS) {
      expect(screen.getByRole('button', { name: tab.label })).toBeTruthy()
    }
    expect(screen.getByText('Ground control for ArduPilot')).toBeTruthy()
    // Found through TABS rather than by a hardcoded label: this broke on a
    // rename that had nothing to do with what it is testing, which is that
    // clicking a rail item mounts its screen.
    const params = TABS.find((t) => t.id === 'parameters')!
    fireEvent.click(screen.getByRole('button', { name: params.label }))
    expect(screen.getByText(/Connect a vehicle to load its parameters/)).toBeTruthy()
  })

  it('switches top-level modes and hides the rail outside Setup', () => {
    render(<App />)
    for (const mode of MODES) {
      expect(screen.getByRole('tab', { name: mode.label })).toBeTruthy()
    }
    // Fly and Mission are full-window: no setup rail alongside them.
    fireEvent.click(screen.getByRole('tab', { name: 'Fly' }))
    expect(screen.queryByRole('button', { name: 'Firmware' })).toBeNull()
    // The flight screen draws with no vehicle rather than describing itself:
    // the map is worth looking at before anything is connected. Asserted by
    // the lower pane's own tabs, which only exist once it has mounted.
    expect(screen.getByRole('tab', { name: 'Messages' })).toBeTruthy()
    // And nothing that commands an aircraft is reachable without one. This
    // is the property that makes drawing it safe, so it is the one pinned.
    expect(screen.getByRole('button', { name: 'RTL' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Mission' }))
    // The planner stands on its own without a vehicle: a mission can be
    // built and saved to a file before anything is connected.
    // The actions column's heading, not one of its buttons: this is asserting
    // that the planner mounted, and it has now broken twice on button wording
    // that was being tuned for entirely unrelated reasons.
    expect(screen.getByRole('heading', { name: 'Mission' })).toBeTruthy()
    expect(screen.getByText(/No items yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Firmware' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(screen.getByRole('button', { name: 'Firmware' })).toBeTruthy()
  })

  it('marks the active mode and tab for assistive tech', () => {
    render(<App />)
    expect(screen.getByRole('tab', { name: 'Setup' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Fly' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('keeps Connect as the single primary action in the app bar', () => {
    render(<App />)
    // The mode switch must not compete with Connect for the orange.
    const connect = screen.getByRole('button', { name: 'Connect' })
    expect(connect.className).toContain('la-btn--primary')
    for (const mode of MODES) {
      expect(screen.getByRole('tab', { name: mode.label }).className).not.toContain('la-btn')
    }
  })
})

describe('the connection menu adapts to what the environment can do', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).loftgcs
  })

  const options = () =>
    Array.from(screen.getByTitle('Connection type').querySelectorAll('option')).map(
      (o) => o.textContent,
    )

  it('leaves TCP and UDP out of a browser, where sockets do not exist', () => {
    render(<AppBar />)
    // Offering them in a browser is offering two ways to fail, in the first
    // menu anyone opens -- which made the web build read as broken.
    expect(options()).toEqual(['USB serial', 'WebSocket', 'Demo'])
  })

  it('offers them in the desktop app, which can open sockets', () => {
    // A bare object used to be enough to say "Electron is here", because
    // nothing in the bar called the bridge. The simulator tray does, so the
    // fake has to carry the part of the surface it uses -- a fake thinner
    // than the contract is a test that passes for the wrong reason.
    ;(window as unknown as Record<string, unknown>).loftgcs = {
      sim: {
        status: () =>
          Promise.resolve({
            supported: true,
            vehicles: [],
            installed: [],
            running: null,
            port: 5760,
          }),
        onProgress: () => () => {},
        onLog: () => () => {},
        onExit: () => () => {},
      },
    }
    render(<AppBar />)
    expect(options()).toEqual(['USB serial', 'TCP', 'UDP', 'WebSocket', 'Demo'])
  })

  it('shows the SITL tray, dark, until something is running', () => {
    render(<AppBar />)
    // The dot is the reason the tray earns bar space: a SITL left running
    // in the background is otherwise invisible from every screen.
    const btn = screen.getByRole('button', { name: /^SITL$/ })
    expect(btn.querySelector('.app-simtray__dot--off')).not.toBeNull()
    expect(btn.getAttribute('title')).toMatch(/not running/i)
  })
})
