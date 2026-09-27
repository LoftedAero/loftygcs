import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import SerialChooserModal from './SerialChooserModal'

// ttyS0-ttyS31 are onboard UARTs Linux enumerates whether or not anything is
// wired to them, so they collapse into a "Built-In" disclosure.

let portsCb: ((list: SerialPortChoice[]) => void) | null = null
let chosen: string | null = null

const bridge = () => ({
  serialPicker: {
    onPortsAvailable: (cb: (list: SerialPortChoice[]) => void) => {
      portsCb = cb
      return () => {
        portsCb = null
      }
    },
    onDone: () => () => {},
    choose: (portId: string) => {
      chosen = portId
    },
    cancel: () => {},
    autoPickNew: () => {},
  },
})

const send = (list: SerialPortChoice[]) => act(() => portsCb?.(list))

const board: SerialPortChoice = { portId: 'a', portName: 'ttyACM0', displayName: 'MatekF765-Wing' }
const builtIns: SerialPortChoice[] = Array.from({ length: 3 }, (_, i) => ({
  portId: `s${i}`,
  portName: `ttyS${i}`,
}))

beforeEach(() => {
  portsCb = null
  chosen = null
  ;(window as unknown as Record<string, unknown>).loftgcs = bridge()
  render(<SerialChooserModal />)
})

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).loftgcs
})

describe('grouping', () => {
  it('lists non-ttyS ports directly and collapses ttyS* ports under Built-In', () => {
    send([board, ...builtIns])
    expect(screen.getByText('ttyACM0')).toBeTruthy()
    expect(screen.queryByText('ttyS0')).toBeNull()
    const toggle = screen.getByRole('button', { name: /Built-in/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(toggle).getByText('3')).toBeTruthy()
  })

  it('expands and collapses the group on click', () => {
    send([board, ...builtIns])
    const toggle = screen.getByRole('button', { name: /Built-in/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ttyS0')).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('ttyS0')).toBeNull()
  })

  it('sorts every non-ttyS port ahead of the Built-In group', () => {
    send([...builtIns, board])
    const names = screen.getAllByText(/^ttyA|^Built-in/).map((el) => el.textContent)
    expect(names[0]).toBe('ttyACM0')
  })

  it('auto-opens the group when the only port is one of its own', () => {
    send(builtIns)
    // The default selection is a ttyS* port here, so it must not be hidden.
    const toggle = screen.getByRole('button', { name: /Built-in/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ttyS0')).toBeTruthy()
  })

  it('does not offer a Built-In group when there are no ttyS* ports', () => {
    send([board])
    expect(screen.queryByRole('button', { name: /Built-in/ })).toBeNull()
  })
})

describe('double click', () => {
  it('connects to the port under the pointer immediately', () => {
    send([board, ...builtIns])
    fireEvent.doubleClick(screen.getByText('ttyACM0'))
    expect(chosen).toBe('a')
  })

  it('works on a Built-In row once the group is open', () => {
    send([board, ...builtIns])
    fireEvent.click(screen.getByRole('button', { name: /Built-in/ }))
    fireEvent.doubleClick(screen.getByText('ttyS1'))
    expect(chosen).toBe('s1')
  })

  it('closes the chooser the same way a single Connect click does', () => {
    send([board])
    fireEvent.doubleClick(screen.getByText('ttyACM0'))
    expect(screen.queryByText('Select serial port')).toBeNull()
  })
})

describe('the default selection', () => {
  const connect = () => fireEvent.click(screen.getByRole('button', { name: 'Connect' }))

  it('is the board, not ttyS0, when the OS lists the built-in ports first', () => {
    // The order Linux reports: ttyS0 upward, then the USB device.
    send([...builtIns, board])
    expect(screen.getByRole('button', { name: /Built-in/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    connect()
    expect(chosen).toBe('a')
  })

  it('moves to a board plugged in after the chooser opened', () => {
    send(builtIns)
    send([...builtIns, board])
    expect(screen.getByRole('button', { name: /Built-in/ }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    connect()
    expect(chosen).toBe('a')
  })

  it('stays on a port somebody picked when the list changes', () => {
    send([board, ...builtIns])
    fireEvent.click(screen.getByRole('button', { name: /Built-in/ }))
    fireEvent.click(screen.getByText('ttyS1'))
    const other: SerialPortChoice = { portId: 'b', portName: 'ttyUSB0' }
    send([other, board, ...builtIns])
    connect()
    expect(chosen).toBe('s1')
  })
})

describe('a selection hidden by collapsing the group', () => {
  it('cannot be connected to until it is shown again', () => {
    send([board, ...builtIns])
    const toggle = screen.getByRole('button', { name: /Built-in/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByText('ttyS1'))
    fireEvent.click(toggle)
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.click(toggle)
    expect(connect.disabled).toBe(false)
  })
})

describe('Connect button', () => {
  it('still sends whichever port is selected', () => {
    send([board, ...builtIns])
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(chosen).toBe('a')
  })
})
