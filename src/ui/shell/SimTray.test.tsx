import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SimTray from './SimTray'
import { useSimStore } from '../../stores/sim-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'

// The simulator moved out of a mode and into the app bar. The two things
// worth holding still are the dot -- the whole reason it earns bar space --
// and that the panel still offers exactly what the screen did.

/** What the last Start handed the main process. */
let started: unknown = null
let pickedBuild: unknown = null
let pickedParams: string | null = null

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
    start: (launch: unknown) => {
      started = launch
      return Promise.resolve(5760)
    },
    stop: () => Promise.resolve(),
    pickBuild: () => Promise.resolve(pickedBuild),
    pickParams: () => Promise.resolve(pickedParams),
    onProgress: () => () => {},
    onLog: () => () => {},
    onExit: () => () => {},
  },
})

const READY = {
  supported: true,
  vehicles: [{ id: 'copter', label: 'ArduCopter' }],
  installed: ['copter'],
  running: null,
  port: 5760,
}

/** An open tray on a desktop build, with a vehicle ready to launch. */
const openTray = () => {
  setBridge(bridge())
  useSimStore.setState({ status: READY })
  render(<SimTray />)
  fireEvent.click(trayButton())
}

const setBridge = (b: unknown) => {
  ;(window as unknown as Record<string, unknown>).loftgcs = b
}

beforeEach(() => {
  started = null
  pickedBuild = null
  pickedParams = null
  localStorage.clear()
  useUiStore.setState({ simTrayOpen: false })
  useSimStore.setState({
    status: null,
    phase: 'idle',
    progress: null,
    error: null,
    build: null,
    physics: { kind: 'builtin' },
    params: { kind: 'wipe' },
    homeText: '',
  })
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

describe('choosing what to launch', () => {
  it('launches the managed build with its own physics and a wipe', async () => {
    openTray()
    fireEvent.click(screen.getByRole('button', { name: /start simulator/i }))
    await waitFor(() => expect(started).not.toBeNull())
    // The defaults are what someone gets who just presses Start -- the
    // behavior before any of this was choosable.
    expect(started).toMatchObject({
      vehicle: 'copter',
      physics: { kind: 'builtin' },
      params: { kind: 'wipe' },
    })
    expect((started as { exe?: string }).exe).toBeUndefined()
  })

  it('takes the vehicle from the build rather than asking', async () => {
    // A binary knows what it is, and asking invites the answer that
    // launches ArduPlane against copter defaults.
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'custom' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    // Named by what it is, not by where it sits.
    expect(screen.getByLabelText('Build').textContent).toMatch(/Plane 4\.6\.3/)
    fireEvent.click(screen.getByRole('button', { name: /start simulator/i }))
    await waitFor(() => expect(started).not.toBeNull())
    expect(started).toMatchObject({ vehicle: 'plane', exe: 'C:/rf/arduplane.exe' })
  })

  it('leaves the setup alone when the picker is cancelled', async () => {
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'custom' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())

    // Cancelling a second pick must not throw the first one away -- the
    // dropdown is only a way to reach the picker, not a choice in itself.
    pickedBuild = null
    fireEvent.click(screen.getByRole('button', { name: /change/i }))
    await new Promise((r) => setTimeout(r, 20))
    expect(useSimStore.getState().build?.path).toBe('C:/rf/arduplane.exe')
  })

  it('sends RealFlight the flightaxis physics, with a host when given one', async () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Physics'), { target: { value: 'flightaxis' } })
    fireEvent.change(screen.getByLabelText('RealFlight host'), {
      target: { value: '192.168.1.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: /start simulator/i }))
    await waitFor(() => expect(started).not.toBeNull())
    expect(started).toMatchObject({ physics: { kind: 'flightaxis', host: '192.168.1.5' } })
  })

  it('says what RealFlight needs switched on, because forgetting it hangs', () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Physics'), { target: { value: 'flightaxis' } })
    expect(screen.getByText(/RealFlight Link enabled/)).toBeTruthy()
  })

  it('tells a parameter list from a stored image when one is picked', async () => {
    pickedParams = 'C:/rf/flightaxis/eeprom.bin'
    openTray()
    const select = () => screen.getByLabelText('Parameters') as HTMLSelectElement
    fireEvent.change(select(), { target: { value: 'file' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('eeprom'))
    expect(screen.getByText(/copied in whole/i)).toBeTruthy()

    pickedParams = 'C:/rf/f35.parm'
    fireEvent.change(select(), { target: { value: 'file' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('file'))
    expect(screen.getByText(/with a wipe so it takes/i)).toBeTruthy()
  })

  it('shows the file it was given, for both kinds of file', async () => {
    // The store being right is not the same as the control being right:
    // 'eeprom' matches no option, and a select whose value matches nothing
    // displays its *first* option -- so this read "Wipe to defaults" while
    // the launch correctly used the EEPROM. Assert what is on screen.
    const select = () => screen.getByLabelText('Parameters') as HTMLSelectElement
    for (const [file, kind] of [
      ['C:/rf/flightaxis/eeprom.bin', 'eeprom'],
      ['C:/rf/f35.parm', 'file'],
    ] as const) {
      pickedParams = file
      useSimStore.setState({ params: { kind: 'wipe' } })
      cleanup()
      // The tray's open state lives in the ui store and outlives the
      // unmount, so without this the next click closes it again.
      useUiStore.setState({ simTrayOpen: false })
      openTray()
      fireEvent.change(select(), { target: { value: 'file' } })
      await waitFor(() => expect(useSimStore.getState().params.kind).toBe(kind))
      expect(select().value).toBe('file')
      expect(select().selectedOptions[0]!.textContent).toBe(file.split('/').pop())
    }
  })

  it('keeps stored parameters when asked, and says what that means', async () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Parameters'), { target: { value: 'keep' } })
    expect(screen.getByText(/Carries on from wherever/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /start simulator/i }))
    await waitFor(() => expect(started).not.toBeNull())
    expect(started).toMatchObject({ params: { kind: 'keep' } })
  })

  it('remembers the setup, because a rig is not a per-launch decision', async () => {
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Physics'), { target: { value: 'flightaxis' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    const saved = JSON.parse(localStorage.getItem('loftgcs.sim.rig')!) as {
      build: { path: string }
      physics: { kind: string }
    }
    expect(saved.build.path).toBe('C:/rf/arduplane.exe')
    expect(saved.physics.kind).toBe('flightaxis')
  })

  it('offers no install for a build that came from disk', async () => {
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'custom' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    // It is already on the disk; there is nothing to download.
    expect(screen.queryByRole('button', { name: /install simulator/i })).toBeNull()
    expect(screen.getByRole('button', { name: /start simulator/i })).toBeTruthy()
  })
})
