import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import App from './App'
import AppBar from './ui/shell/AppBar'
import { MODES, TABS, useUiStore, visibleTabs } from './stores/ui-store'
import { useConnectionStore } from './stores/connection-store'

// Testing Library only auto-cleans between tests when the runner exposes
// globals; we keep globals off, so unmount explicitly.
afterEach(cleanup)
beforeEach(() => useUiStore.setState({ mode: 'setup', activeTab: 'overview' }))

describe('app shell', () => {
  it('lists only the sections that work with no vehicle, and switches between them', () => {
    // The rail is a list of what can be done now. A vehicle-only screen is
    // not in it -- Mission Planner's behaviour, and its wiki says so: "You
    // will only see this menu item if the autopilot is connected." What this
    // replaced was a card on each of eleven tabs describing the screen you
    // could not use, which none of QGC, Mission Planner or Betaflight does.
    render(<App />)
    for (const tab of visibleTabs(false)) {
      expect(screen.getByRole('button', { name: tab.label })).toBeTruthy()
    }
    for (const tab of TABS.filter((t) => !visibleTabs(false).some((v) => v.id === t.id))) {
      expect(screen.queryByRole('button', { name: tab.label })).toBeNull()
    }
    // Sensors is the shape of the ones that go: nothing on it can be done
    // without an aircraft answering. So is Overview -- it draws itself
    // rather than describing itself, which is why it survived the earlier
    // pass, but what it draws is a vehicle.
    expect(screen.queryByRole('button', { name: 'Sensors' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()
    // Found through TABS rather than by a hardcoded label: this broke on a
    // rename that had nothing to do with what it is testing, which is that
    // clicking a rail item mounts its screen.
    const params = TABS.find((t) => t.id === 'parameters')!
    fireEvent.click(screen.getByRole('button', { name: params.label }))
    // The ordinary screen with an empty table, not a disconnected-only card:
    // the column beside it already carries the control that fills it.
    expect(screen.getByPlaceholderText('Search parameters')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import from file/i })).toBeTruthy()
  })

  it('leaves a vehicle-only tab when the vehicle goes', () => {
    // Nobody should be left looking at a screen the rail no longer offers.
    useUiStore.setState({ mode: 'setup', activeTab: 'sensors' })
    render(<App />)
    // The top of what is left, read from the list rather than named here.
    expect(useUiStore.getState().activeTab).toBe(visibleTabs(false)[0]!.id)
  })

  it('stays on a vehicle-only tab through a reboot', () => {
    // The app reconnects by itself after a reboot it asked for, so the screen
    // that asked for it is where the user should land again.
    useConnectionStore.setState({ phase: 'rebooting' })
    useUiStore.setState({ mode: 'setup', activeTab: 'sensors' })
    render(<App />)
    expect(useUiStore.getState().activeTab).toBe('sensors')
    expect(screen.getByRole('button', { name: 'Sensors' })).toBeTruthy()
    useConnectionStore.setState({ phase: 'idle' })
  })

  it('draws the Overview readouts once there is a vehicle to read', () => {
    // Overview renders itself rather than describing itself -- it used to be
    // a card describing the app. Asserted with a vehicle now, because that
    // is the only state it is reachable in.
    useConnectionStore.setState({ phase: 'connected' })
    useUiStore.setState({ mode: 'setup', activeTab: 'overview' })
    render(<App />)
    expect(screen.getByRole('heading', { name: 'GPS' })).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    useConnectionStore.setState({ phase: 'idle' })
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

    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))
    // The planner stands on its own without a vehicle: a mission can be
    // built and saved to a file before anything is connected.
    // The actions column's heading, not one of its buttons: this is asserting
    // that the planner mounted, and it has now broken twice on button wording
    // that was being tuned for entirely unrelated reasons. Still "Mission"
    // while the mode above it is "Plan": the mode edits three plans and this
    // names the one selected.
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
    const first = visibleTabs(false)[0]!
    useUiStore.setState({ activeTab: first.id })
    expect(screen.getByRole('button', { name: first.label }).getAttribute('aria-current')).toBe(
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

  it('holds Connect while a reboot is being waited out, and leaves Disconnect to give up', () => {
    // The service is already reopening the port; a second Connect would race
    // it for the device. The wait ends itself, to an error that frees Connect.
    const connect = () => screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    const disconnect = () => screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement
    useConnectionStore.setState({ phase: 'rebooting' })
    const { rerender } = render(<AppBar />)
    expect(connect().disabled).toBe(true)
    expect((screen.getByTitle('Connection type') as HTMLSelectElement).disabled).toBe(true)
    expect(disconnect().disabled).toBe(false)

    useConnectionStore.setState({
      phase: 'error',
      error: 'The vehicle did not come back after the reboot. Reconnect to retry.',
    })
    rerender(<AppBar />)
    expect(connect().disabled).toBe(false)
    useConnectionStore.setState({ phase: 'idle', error: null })
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
