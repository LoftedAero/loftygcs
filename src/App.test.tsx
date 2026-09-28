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
    // Vehicle-only screens are left off the rail, as Mission Planner does.
    render(<App />)
    for (const tab of visibleTabs(false)) {
      expect(screen.getByRole('button', { name: tab.label })).toBeTruthy()
    }
    for (const tab of TABS.filter((t) => !visibleTabs(false).some((v) => v.id === t.id))) {
      expect(screen.queryByRole('button', { name: tab.label })).toBeNull()
    }
    // Overview is vehicle-only too: what it draws is the vehicle.
    expect(screen.queryByRole('button', { name: 'Sensors' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()
    // Looked up through TABS so a label change does not break this.
    const params = TABS.find((t) => t.id === 'parameters')!
    fireEvent.click(screen.getByRole('button', { name: params.label }))
    // The ordinary screen with an empty table and its import control.
    expect(screen.getByPlaceholderText('Search parameters')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import from file/i })).toBeTruthy()
  })

  it('leaves a vehicle-only tab when the vehicle goes', () => {
    useUiStore.setState({ mode: 'setup', activeTab: 'sensors' })
    render(<App />)
    // The first tab left on the rail.
    expect(useUiStore.getState().activeTab).toBe(visibleTabs(false)[0]!.id)
  })

  it('stays on a vehicle-only tab through a reboot', () => {
    // The app reconnects by itself, so the user lands back on the same screen.
    useConnectionStore.setState({ phase: 'rebooting' })
    useUiStore.setState({ mode: 'setup', activeTab: 'sensors' })
    render(<App />)
    expect(useUiStore.getState().activeTab).toBe('sensors')
    expect(screen.getByRole('button', { name: 'Sensors' })).toBeTruthy()
    useConnectionStore.setState({ phase: 'idle' })
  })

  it('draws the Overview readouts once there is a vehicle to read', () => {
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
    // The flight screen renders with no vehicle; the lower pane's tabs show
    // it mounted.
    expect(screen.getByRole('tab', { name: 'Messages' })).toBeTruthy()
    // Nothing that commands an aircraft is enabled without one, which is what
    // makes drawing the screen safe.
    expect(screen.getByRole('button', { name: 'RTL' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))
    // The planner works without a vehicle. Checked by the column heading
    // rather than button wording; "Mission" names the plan selected within
    // the Plan mode.
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
    expect(options()).toEqual(['USB serial', 'WebSocket'])
  })

  it('offers them in the desktop app, which can open sockets', () => {
    // The fake carries the part of the bridge the simulator tray calls.
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
    expect(options()).toEqual(['USB serial', 'TCP', 'UDP', 'WebSocket'])
  })

  it('holds Connect while a reboot is being waited out, and leaves Disconnect to give up', () => {
    // The service is already reopening the port; a second Connect would race
    // it. The wait ends in an error that re-enables Connect.
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
    // The dot shows a SITL left running in the background.
    const btn = screen.getByRole('button', { name: /^SITL$/ })
    expect(btn.querySelector('.app-simtray__dot--off')).not.toBeNull()
    expect(btn.getAttribute('title')).toMatch(/not running/i)
  })
})
