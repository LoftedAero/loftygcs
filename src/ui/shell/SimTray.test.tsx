import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SimTray from './SimTray'
import { useSimStore } from '../../stores/sim-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'

// The SITL tray in the app bar: its running indicator dot, and the launch
// options its panel offers.

/** What the last Start handed the main process. */
let started: unknown = null
let pickedBuild: unknown = null
let pickedParams: string | null = null
/** Which folder each dialog was asked to open at. */
const startedAt: { build?: string | undefined; params?: string | undefined } = {}

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
    pickBuild: (startIn?: string) => {
      startedAt.build = startIn
      return Promise.resolve(pickedBuild)
    },
    pickParams: (startIn?: string) => {
      startedAt.params = startIn
      return Promise.resolve(pickedParams)
    },
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
    homes: { builtin: '', flightaxis: '' },
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
    // The port matters: a second SITL lands on a different one.
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

  // A simulator still running must not show as idle, so both of the store's
  // sources of truth are consulted.
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
    render(<SimTray />)
    act(() => useUiStore.getState().setSimTrayOpen(true))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('what the panel offers', () => {
  it('explains itself in a browser rather than showing dead controls', () => {
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('dialog').textContent).toMatch(/requires the desktop app/i)
    expect(screen.queryByRole('button', { name: /launch SITL instance/i })).toBeNull()
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
    expect(screen.queryByRole('button', { name: /^launch SITL instance$/i })).toBeNull()
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
    expect(screen.getByRole('button', { name: /launch SITL instance/i })).toBeTruthy()

    act(() => useSimStore.setState({ phase: 'running' }))
    expect(screen.getByRole('button', { name: /stop simulator/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /launch SITL instance/i })).toBeNull()
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
      (screen.getByRole('button', { name: /launch SITL instance/i }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/disconnect the current vehicle/i)).toBeTruthy()
    useConnectionStore.setState({ phase: 'idle' })
  })

  it('always offers to attach to a simulator someone else started', () => {
    setBridge(bridge())
    render(<SimTray />)
    fireEvent.click(trayButton())
    expect(screen.getByRole('button', { name: /connect existing instance/i })).toBeTruthy()
  })
})

describe('choosing what to launch', () => {
  it('launches the managed build with its own physics and a wipe', async () => {
    openTray()
    fireEvent.click(screen.getByRole('button', { name: /launch SITL instance/i }))
    await waitFor(() => expect(started).not.toBeNull())
    // The defaults, for someone who just presses Start.
    expect(started).toMatchObject({
      vehicle: 'copter',
      physics: { kind: 'builtin' },
      params: { kind: 'wipe' },
    })
    expect((started as { exe?: string }).exe).toBeUndefined()
  })

  it('takes the vehicle from the build rather than asking', async () => {
    // The binary says which vehicle it is; asking could launch ArduPlane
    // against copter defaults.
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    // Named by what it is, not by where it sits.
    expect(screen.getByLabelText('Build').textContent).toMatch(/Plane 4\.6\.3/)
    fireEvent.click(screen.getByRole('button', { name: /launch SITL instance/i }))
    await waitFor(() => expect(started).not.toBeNull())
    expect(started).toMatchObject({ vehicle: 'plane', exe: 'C:/rf/arduplane.exe' })
  })

  it('leaves the setup alone when the picker is cancelled', async () => {
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())

    // Cancelling a second pick keeps the first. Re-choosing the custom
    // option is how a build is changed, so this must be safe.
    pickedBuild = null
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(useSimStore.getState().build?.path).toBe('C:/rf/arduplane.exe')
  })

  it('sends RealFlight the flightaxis physics, and no address', async () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Physics'), { target: { value: 'flightaxis' } })
    fireEvent.click(screen.getByRole('button', { name: /launch SITL instance/i }))
    await waitFor(() => expect(started).not.toBeNull())
    // RealFlight is assumed to be on this machine, so there is no host.
    expect(started).toMatchObject({ physics: { kind: 'flightaxis' } })
    expect(screen.queryByLabelText('RealFlight host')).toBeNull()
  })

  it('says what RealFlight needs switched on, because forgetting it hangs', () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Physics'), { target: { value: 'flightaxis' } })
    expect(screen.getByText(/RealFlight Link must be enabled/i)).toBeTruthy()
  })

  it('tells a parameter list from a stored image when one is picked', async () => {
    // An eeprom.bin is copied in whole and a .parm needs a wipe to take
    // effect. Which one it is comes from the file name.
    pickedParams = 'C:/rf/flightaxis/eeprom.bin'
    openTray()
    const select = () => screen.getByLabelText('Parameters') as HTMLSelectElement
    fireEvent.change(select(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('eeprom'))
    expect(select().options[select().selectedIndex]?.text).toBe('eeprom.bin')
    // The full path is in the tooltip.
    expect(select().getAttribute('title')).toBe('C:/rf/flightaxis/eeprom.bin')

    pickedParams = 'C:/rf/f35.parm'
    fireEvent.change(select(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('file'))
    expect(select().options[select().selectedIndex]?.text).toBe('f35.parm')
  })

  it('names a custom build by what it is and which file it is', async () => {
    pickedBuild = { path: 'C:/rf/f35b/ArduPlane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    const select = () => screen.getByLabelText('Build') as HTMLSelectElement
    fireEvent.change(select(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    // Vehicle and version come from the binary; the file name tells two
    // builds apart.
    expect(select().options[select().selectedIndex]?.text).toBe('Plane 4.6.3 · ArduPlane.exe')
    expect(select().getAttribute('title')).toBe('C:/rf/f35b/ArduPlane.exe')
    // A build says which vehicle it is, so there is nothing left to choose.
    expect(screen.queryByLabelText('Vehicle')).toBeNull()
  })

  it('can still reach the picker once something is already chosen', async () => {
    // Re-selecting the already-selected option fires no change event, so the
    // picker needs its own entry.
    pickedBuild = { path: 'C:/rf/one/ArduPlane.exe', vehicle: 'plane', version: '4.6.3' }
    pickedParams = 'C:/rf/one.parm'
    openTray()
    const build = () => screen.getByLabelText('Build') as HTMLSelectElement
    const params = () => screen.getByLabelText('Parameters') as HTMLSelectElement
    fireEvent.change(build(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build?.path).toContain('one'))
    fireEvent.change(params(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('file'))

    const texts = (el: HTMLSelectElement) => [...el.options].map((o) => o.text)
    expect(texts(build())).toContain('Select from file')
    expect(texts(params())).toContain('Select from file')

    // And it really opens: a second pick replaces the first.
    pickedBuild = { path: 'C:/rf/two/ArduCopter.exe', vehicle: 'copter', version: '4.7.1' }
    fireEvent.change(build(), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build?.path).toContain('two'))
  })

  it('opens the parameter dialog in the folder the build came from', async () => {
    // An aircraft ships as an executable beside its <model>/eeprom.bin, so
    // the build's folder is where the parameters live. Backslashes, as a
    // Windows dialog returns them.
    pickedBuild = { path: String.raw`C:\rf\f35b\ArduPlane.exe`, vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    expect(useSimStore.getState().browseDir).toBe(String.raw`C:\rf\f35b`)

    pickedParams = String.raw`C:\rf\f35b\eeprom.bin`
    fireEvent.change(screen.getByLabelText('Parameters'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('eeprom'))
    expect(startedAt.params).toBe(String.raw`C:\rf\f35b`)
    // And the name in the field is the file, not the whole path.
    const sel = screen.getByLabelText('Parameters') as HTMLSelectElement
    expect(sel.options[sel.selectedIndex]?.text).toBe('eeprom.bin')
  })

  it('remembers the folder for the next session', async () => {
    pickedParams = String.raw`D:ields\one.parm`
    openTray()
    fireEvent.change(screen.getByLabelText('Parameters'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().params.kind).toBe('file'))
    // Persisted across sessions.
    expect(localStorage.getItem('loftgcs.sim.browseDir')).toBe(String.raw`D:ields`)
  })

  it('leaves the control on what is loaded when a picker is cancelled', async () => {
    pickedBuild = null
    openTray()
    const build = () => screen.getByLabelText('Build') as HTMLSelectElement
    fireEvent.change(build(), { target: { value: 'pick' } })
    await new Promise((r) => setTimeout(r, 20))
    // Nothing changed, so nothing re-rendered; the select must not be left
    // on the picker action.
    expect(build().value).toBe('official')
  })

  it('shows the file it was given, for both kinds of file', async () => {
    // Assert what is on screen, not just the store: a select whose value
    // matches no option displays its first option.
    const select = () => screen.getByLabelText('Parameters') as HTMLSelectElement
    for (const [file, kind] of [
      ['C:/rf/flightaxis/eeprom.bin', 'eeprom'],
      ['C:/rf/f35.parm', 'file'],
    ] as const) {
      pickedParams = file
      useSimStore.setState({ params: { kind: 'wipe' } })
      cleanup()
      // The tray's open state lives in the ui store and outlives the unmount.
      useUiStore.setState({ simTrayOpen: false })
      openTray()
      fireEvent.change(select(), { target: { value: 'pick' } })
      await waitFor(() => expect(useSimStore.getState().params.kind).toBe(kind))
      expect(select().value).toBe('file')
      expect(select().selectedOptions[0]!.textContent).toBe(file.split('/').pop())
    }
  })

  it('keeps stored parameters when asked, and says what that means', async () => {
    openTray()
    fireEvent.change(screen.getByLabelText('Parameters'), { target: { value: 'keep' } })
    expect(screen.getByText(/Carries on from wherever/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /launch SITL instance/i }))
    await waitFor(() => expect(started).not.toBeNull())
    expect(started).toMatchObject({ params: { kind: 'keep' } })
  })

  it('remembers the setup, because a rig is not a per-launch decision', async () => {
    pickedBuild = { path: 'C:/rf/arduplane.exe', vehicle: 'plane', version: '4.6.3' }
    openTray()
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
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
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: 'pick' } })
    await waitFor(() => expect(useSimStore.getState().build).not.toBeNull())
    // It is already on the disk; there is nothing to download.
    expect(screen.queryByRole('button', { name: /install simulator/i })).toBeNull()
    expect(screen.getByRole('button', { name: /launch SITL instance/i })).toBeTruthy()
  })
})

describe('where a simulator boots when nobody has said', () => {
  // The default home follows the simulator: SITL's own physics defaults to
  // CMAC, and RealFlight's default scenery is Eli Field.
  const setHome = (text: string) => act(() => useSimStore.getState().setHomeText(text))

  it('boots at CMAC on the built-in physics', () => {
    openTray()
    setHome('')
    expect(screen.getByText('Default — CMAC')).toBeTruthy()
  })

  it('boots at Eli Field on RealFlight', () => {
    openTray()
    setHome('')
    act(() => useSimStore.getState().setPhysics({ kind: 'flightaxis' }))
    expect(screen.getByText('Default — Eli Field')).toBeTruthy()
  })

  it('lets a picked location beat either default', () => {
    openTray()
    act(() => useSimStore.getState().setPhysics({ kind: 'flightaxis' }))
    // What the map picker writes.
    setHome('51.5,-0.1,25,90')
    expect(screen.queryByText('Default — Eli Field')).toBeNull()
    expect(screen.getByText(/51\.500000, -0\.100000 · 25 m · 90°/)).toBeTruthy()
  })
})

describe('a home per simulator, remembered separately', () => {
  // A location measured against RealFlight's scenery means nothing to SITL's
  // own model, so each physics keeps its own home.
  const setHome = (text: string) => act(() => useSimStore.getState().setHomeText(text))
  const setPhysics = (kind: 'builtin' | 'flightaxis') =>
    act(() => useSimStore.getState().setPhysics({ kind }))

  it('leaves the built-in home behind when RealFlight is selected', () => {
    openTray()
    setHome('51.5,-0.1,25,90')
    expect(screen.getByText(/51\.500000/)).toBeTruthy()
    // RealFlight has none set, so it uses its own default.
    setPhysics('flightaxis')
    expect(screen.getByText('Default — Eli Field')).toBeTruthy()
  })

  it('gives the built-in home back on the way out', () => {
    openTray()
    setHome('51.5,-0.1,25,90')
    setPhysics('flightaxis')
    setPhysics('builtin')
    expect(screen.getByText(/51\.500000, -0\.100000 · 25 m · 90°/)).toBeTruthy()
  })

  it('keeps a RealFlight home for RealFlight only', () => {
    openTray()
    setHome('51.5,-0.1,25,90')
    setPhysics('flightaxis')
    setHome('40.059422,-88.551405,206,43')
    // Each simulator keeps its own.
    setPhysics('builtin')
    expect(screen.getByText(/51\.500000/)).toBeTruthy()
    setPhysics('flightaxis')
    expect(screen.getByText(/40\.059422/)).toBeTruthy()
    expect(useSimStore.getState().homes).toEqual({
      builtin: '51.5,-0.1,25,90',
      flightaxis: '40.059422,-88.551405,206,43',
    })
  })
})

describe('launching onto RealFlight before RealFlight is up', () => {
  it('says the simulator is waiting rather than reporting a failure', () => {
    openTray()
    // After mounting, since subscribing to simulator events resets the phase
    // to idle and clears this flag.
    act(() => useSimStore.setState({ waitingForRealFlight: true }))
    // SITL is running and retries the SOAP connection for as long as it
    // lives; it just has nothing to send yet.
    expect(screen.getByText(/waiting for RealFlight/i)).toBeTruthy()
    expect(useSimStore.getState().error).toBeNull()
  })
})
