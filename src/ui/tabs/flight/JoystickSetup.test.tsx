import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import JoystickSetup from './JoystickSetup'
import { padName } from './JoystickPanel'
import JoystickChip from '../../shell/JoystickChip'
import { useJoystickStore } from '../../../stores/joystick-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { DEFAULT_CONFIG } from '../../../protocol/joystick'
import * as joystick from '../../../services/joystick'

const PAD = { index: 0, id: 'Xbox Wireless Controller' }

beforeEach(() => {
  localStorage.clear()
  useJoystickStore.setState({
    config: DEFAULT_CONFIG,
    devices: {},
    profiles: {},
    configFor: null,
    pads: [],
    pad: null,
    // A pad with five axes and three buttons, at rest.
    axes: [0, 1, 0, 0, 0],
    buttons: [false, false, false],
    active: false,
  })
  useJoystickStore.getState().setPads([PAD], PAD)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const live = (axes: number[], buttons: boolean[]) =>
  act(() => useJoystickStore.getState().setLive(axes, buttons, []))

function pickFile(contents: string, name = 'profile.json') {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!
  // jsdom's File has no text(); a browser's does, and the dialog uses it.
  const file = Object.assign(new File([contents], name, { type: 'application/json' }), {
    text: () => Promise.resolve(contents),
  })
  fireEvent.change(input, { target: { files: [file] } })
}

describe('learning a control', () => {
  it('takes the axis that moves, not the one that happened to be first', () => {
    render(<JoystickSetup open onClose={() => {}} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Learn' })[0]!)
    // Movement is measured from where the controls were at Learn, so the
    // throttle resting at one end is not a movement, and a little drift on
    // another axis is not one either.
    live([0.1, 1, 0, 0, 0], [false, false, false])
    live([0.1, 1, 0, 0, -0.9], [false, false, false])
    expect(useJoystickStore.getState().config.axes[0]!.axis).toBe(4)
  })

  it('takes the button pressed after Learn, not one already held', () => {
    useJoystickStore.getState().setConfig({
      buttons: [{ channel: 5, button: -1, mode: 'toggle', values: [1000, 2000] }],
    })
    render(<JoystickSetup open onClose={() => {}} />)
    // Button 0 is under a thumb before Learn is pressed.
    live([0, 1, 0, 0, 0], [true, false, false])
    const learn = screen.getAllByRole('button', { name: 'Learn' })
    // Rows: four axes, then the one button.
    fireEvent.click(learn[4]!)
    live([0, 1, 0, 0, 0], [true, false, true])
    expect(useJoystickStore.getState().config.buttons[0]!.button).toBe(2)
  })
})

describe('profiles', () => {
  it('saves under a name and loads it back', () => {
    render(<JoystickSetup open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save as' }))
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'Racing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(Object.keys(useJoystickStore.getState().profiles)).toEqual(['Racing'])
    expect(screen.getByRole('status').textContent).toBe('Saved Racing')
  })

  it('imports a file this app exported', async () => {
    render(<JoystickSetup open onClose={() => {}} />)
    const config = { ...DEFAULT_CONFIG, deadzone: 0.2 }
    pickFile(
      JSON.stringify({ kind: 'loftgcs-joystick-profile', version: 1, name: 'HOTAS', config }),
    )
    await waitFor(() => expect(useJoystickStore.getState().profiles.HOTAS).toBeDefined())
    // Imported and loaded onto the device in hand.
    expect(useJoystickStore.getState().config.deadzone).toBe(0.2)
  })

  it('refuses a JSON file that is not a mapping, rather than loading the defaults', async () => {
    useJoystickStore.getState().setConfig({ deadzone: 0.3 })
    render(<JoystickSetup open onClose={() => {}} />)
    pickFile(JSON.stringify({ name: 'package', version: '1.0.0' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not a joystick/))
    expect(useJoystickStore.getState().profiles).toEqual({})
    expect(useJoystickStore.getState().config.deadzone).toBe(0.3)
  })

  it('refuses a file that is not JSON', async () => {
    render(<JoystickSetup open onClose={() => {}} />)
    pickFile('axes: [1, 2]')
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/not a joystick/))
  })
})

describe('the app bar while the gamepad has control', () => {
  it('draws nothing when it does not', () => {
    const { container } = render(<JoystickChip />)
    expect(container.innerHTML).toBe('')
  })

  it('offers Release from every screen', () => {
    const stop = vi.spyOn(joystick, 'stop').mockImplementation(() => {})
    useJoystickStore.setState({ active: true })
    render(<JoystickChip />)
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(stop).toHaveBeenCalled()
  })
})

describe('device names', () => {
  it('drops what the browser adds to a device name', () => {
    expect(padName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)')).toBe(
      'Xbox Wireless Controller',
    )
    expect(padName('T.16000M (Vendor: 044f Product: b10a)')).toBe('T.16000M')
    expect(padName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox 360 Controller')
    expect(padName('045e-02fd-Xbox Wireless Controller')).toBe('Xbox Wireless Controller')
  })

  it('keeps a parenthesis that is part of the name', () => {
    expect(padName('Wireless Controller (PS5)')).toBe('Wireless Controller (PS5)')
  })
})

describe('profiles as files', () => {
  /** What Export wrote, and under which file name. */
  async function saved(): Promise<{ file: string; body: { name: string; config: unknown } }> {
    let blob: Blob | null = null
    let file = ''
    // jsdom has neither, so they are installed rather than spied on.
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob
      return 'blob:x'
    }
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      file = this.download
    })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.readAsText(blob!)
    })
    return { file, body: JSON.parse(text) }
  }
  const openDialog = () =>
    screen.getByRole('button', { name: 'Replace profile' }).closest('.la-modal')!

  it('saves the picked profile, not the mapping in use, under its name', async () => {
    useJoystickStore.getState().importProfile('Racing', { ...DEFAULT_CONFIG, deadzone: 0.25 })
    useJoystickStore.getState().setConfig({ deadzone: 0.1 })
    render(<JoystickSetup open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Saved profiles'), { target: { value: 'Racing' } })
    const { file, body } = await saved()
    expect(file).toBe('Racing.joystick.json')
    expect((body.config as { deadzone: number }).deadzone).toBe(0.25)
  })

  it('saves the mapping in use when no profile is picked', async () => {
    useJoystickStore.getState().setConfig({ deadzone: 0.1 })
    render(<JoystickSetup open onClose={() => {}} />)
    const { file, body } = await saved()
    expect(file).toBe('Gamepad.joystick.json')
    expect((body.config as { deadzone: number }).deadzone).toBe(0.1)
  })

  it('asks before replacing a different profile of the same name', async () => {
    useJoystickStore.getState().importProfile('HOTAS', { ...DEFAULT_CONFIG, deadzone: 0.3 })
    render(<JoystickSetup open onClose={() => {}} />)
    const config = { ...DEFAULT_CONFIG, deadzone: 0.2 }
    pickFile(
      JSON.stringify({ kind: 'loftgcs-joystick-profile', version: 1, name: 'HOTAS', config }),
    )
    await waitFor(() => expect(openDialog().classList.contains('hidden')).toBe(false))
    expect(useJoystickStore.getState().profiles.HOTAS!.deadzone).toBe(0.3)
    fireEvent.click(screen.getByRole('button', { name: 'Replace profile' }))
    expect(useJoystickStore.getState().profiles.HOTAS!.deadzone).toBe(0.2)
    expect(useJoystickStore.getState().config.deadzone).toBe(0.2)
  })

  it('leaves the saved profile alone when replacing is canceled', async () => {
    useJoystickStore.getState().importProfile('HOTAS', { ...DEFAULT_CONFIG, deadzone: 0.3 })
    render(<JoystickSetup open onClose={() => {}} />)
    const config = { ...DEFAULT_CONFIG, deadzone: 0.2 }
    pickFile(JSON.stringify({ name: 'HOTAS', config }))
    await waitFor(() => expect(openDialog().classList.contains('hidden')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useJoystickStore.getState().profiles.HOTAS!.deadzone).toBe(0.3)
    expect(openDialog().classList.contains('hidden')).toBe(true)
  })

  it('does not ask when the file holds the same profile again', async () => {
    useJoystickStore.getState().importProfile('HOTAS', { ...DEFAULT_CONFIG, deadzone: 0.3 })
    render(<JoystickSetup open onClose={() => {}} />)
    const config = { ...DEFAULT_CONFIG, deadzone: 0.3 }
    pickFile(JSON.stringify({ name: 'HOTAS', config }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Loaded HOTAS'))
    expect(openDialog().classList.contains('hidden')).toBe(true)
  })
})

describe('flight mode buttons in the table', () => {
  it('offer the connected vehicle’s modes, and no channel', () => {
    useVehicleStore.setState({ present: true, vehicleType: 1 })
    useJoystickStore.getState().setConfig({
      buttons: [{ channel: 5, button: 0, mode: 'toggle', values: [1000, 2000] }],
    })
    render(<JoystickSetup open onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('What the button for channel 5 does'), {
      target: { value: 'mode' },
    })
    const channel = screen.getByLabelText('Channel for flight mode row 1') as HTMLSelectElement
    expect(channel.disabled).toBe(true)
    const modes = screen.getByLabelText('Flight mode for flight mode row 1') as HTMLSelectElement
    const names = [...modes.options].map((o) => o.value)
    // Plane's own list: FBWA is there, Copter's PosHold is not.
    expect(names).toContain('FBWA')
    expect(names).not.toContain('PosHold')
    fireEvent.change(modes, { target: { value: 'RTL' } })
    expect(useJoystickStore.getState().config.buttons[0]).toEqual({
      channel: 5,
      button: 0,
      mode: 'mode',
      values: [],
      flightMode: 'RTL',
    })
  })

  it('reads back a mode this vehicle does not have, rather than losing it', () => {
    useVehicleStore.setState({ present: true, vehicleType: 1 })
    useJoystickStore.getState().setConfig({
      buttons: [{ channel: 5, button: 0, mode: 'mode', values: [], flightMode: 'PosHold' }],
    })
    render(<JoystickSetup open onClose={() => {}} />)
    expect(
      (screen.getByLabelText('Flight mode for flight mode row 1') as HTMLSelectElement).value,
    ).toBe('PosHold')
  })
})
