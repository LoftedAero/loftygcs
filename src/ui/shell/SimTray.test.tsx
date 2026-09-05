import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SimTray from './SimTray'
import { useSimStore } from '../../stores/sim-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'

// The simulator moved out of a mode and into the app bar. The two things
// worth holding still are the dot -- the whole reason it earns bar space --
// and that the panel still offers exactly what the screen did.

const bridge = (over: Partial<Record<string, unknown>> = {}) => ({
  platform: 'win32',
  sim: {
    status: () =>
      Promise.resolve({
        supported: true,
        vehicles: [
          { id: 'copter', label: 'ArduCopter' },
          { id: 'plane', label: 'ArduPlane' },
        ],
        installed: ['copter'],
        running: null,
        port: 5760,
        ...over,
      }),
    install: () => Promise.resolve(),
    start: () => Promise.resolve(5760),
    stop: () => Promise.resolve(),
    onProgress: () => () => {},
    onLog: () => () => {},
    onExit: () => () => {},
  },
})

const setBridge = (b: unknown) => {
  ;(window as unknown as Record<string, unknown>).loftgcs = b
}

beforeEach(() => {
  useUiStore.setState({ simTrayOpen: false })
  useSimStore.setState({ status: null, phase: 'idle', progress: null, error: null })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).loftgcs
})

const trayButton = () => screen.getByRole('button', { name: /^SITL$/ })

describe('the dot', () => {
  it('is dark, and says so, when nothing is running', () => {
    render(<SimTray />)
    expect(trayButton().querySelector('.app-simtray__dot--off')).not.toBeNull()
    expect(trayButton().title).toMatch(/not running/i)
  })

  it('names the vehicle and port once one is up', () => {
    render(<SimTray />)
    act(() =>
      useSimStore.setState({
        phase: 'running',
        status: { supported: true, vehicles: [], installed: [], running: 'copter', port: 5762 },
      }),
    )
    expect(trayButton().querySelector('.app-simtray__dot--ok')).not.toBeNull()
    // The port matters: a second SITL lands on a different one, and the
    // question the dot gets asked is "which one am I talking to".
    expect(trayButton().title).toMatch(/copter running on port 5762/i)
  })

  it('shows a working state while installing or starting', () => {
    render(<SimTray />)
    act(() => useSimStore.setState({ phase: 'installing' }))
    expect(trayButton().querySelector('.app-simtray__dot--busy')).not.toBeNull()
    act(() => useSimStore.setState({ phase: 'starting' }))
    expect(trayButton().querySelector('.app-simtray__dot--busy')).not.toBeNull()
  })

  it('goes red when the simulator failed', () => {
    render(<SimTray />)
    act(() => useSimStore.setState({ phase: 'error', error: 'port in use' }))
    expect(trayButton().querySelector('.app-simtray__dot--bad')).not.toBeNull()
  })

  // A simulator still running while the tray reports idle is the exact
  // confusion the dot exists to prevent, so the store's two sources of
  // truth are both consulted.
  it('trusts the status over the phase', () => {
    render(<SimTray />)
    act(() =>
      useSimStore.setState({
        phase: 'idle',
        status: { supported: true, vehicles: [], installed: [], running: 'plane', port: 5760 },
      }),
    )
    expect(trayButton().querySelector('.app-simtray__dot--ok')).not.toBeNull()
  })
})

describe('opening and dismissing', () => {
  it('opens on click and closes on Escape', () => {
    render(<SimTray />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trayButton())
    expect(screen.getByRole('dialog', { name: 'SITL' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when the click lands anywhere else', () => {
    render(<SimTray />)
    fireEvent.click(trayButton())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays open for a click inside itself', () => {
    setBridge(bridge())
    render(<SimTray />)
    fireEvent.click(trayButton())
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('opens when another screen asks it to', () => {
    // Overview's "Run a simulator…" used to switch mode; it points here now.
    render(<SimTray />)
    act(() => useUiStore.getState().setSimTrayOpen(true))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('what the panel offers', () => {
  it('explains itself in a browser rather than showing dead controls', () => {
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('dialog').textContent).toMatch(/cannot start a process/i)
    // And points at the two things that do work from a browser tab.
    expect(screen.getByRole('dialog').textContent).toMatch(/WebSocket/)
    expect(screen.getByRole('dialog').textContent).toMatch(/Demo mode/)
    expect(screen.queryByRole('button', { name: /start simulator/i })).toBeNull()
  })

  it('offers Install for a vehicle that is not downloaded yet', () => {
    setBridge(bridge())
    useSimStore.setState({
      status: {
        supported: true,
        vehicles: [{ id: 'plane', label: 'ArduPlane' }],
        installed: [],
        running: null,
        port: 5760,
      },
    })
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('button', { name: /install simulator/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^start simulator$/i })).toBeNull()
    expect(screen.getByText(/about 20 MB/i)).toBeTruthy()
  })

  it('offers Start once it is installed, and Stop once it is running', () => {
    setBridge(bridge())
    useSimStore.setState({
      status: {
        supported: true,
        vehicles: [{ id: 'copter', label: 'ArduCopter' }],
        installed: ['copter'],
        running: null,
        port: 5760,
      },
    })
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('button', { name: /start simulator/i })).toBeTruthy()

    act(() => useSimStore.setState({ phase: 'running' }))
    expect(screen.getByRole('button', { name: /stop simulator/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /start simulator/i })).toBeNull()
  })

  it('will not start one over a vehicle that is already connected', () => {
    setBridge(bridge())
    useSimStore.setState({
      status: {
        supported: true,
        vehicles: [{ id: 'copter', label: 'ArduCopter' }],
        installed: ['copter'],
        running: null,
        port: 5760,
      },
    })
    useConnectionStore.setState({ phase: 'connected' })
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(
      (screen.getByRole('button', { name: /start simulator/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/disconnect the current vehicle/i)).toBeTruthy()
    useConnectionStore.setState({ phase: 'idle' })
  })

  it('always offers to attach to a simulator someone else started', () => {
    setBridge(bridge())
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('button', { name: /connect to a running simulator/i })).toBeTruthy()
  })
})
