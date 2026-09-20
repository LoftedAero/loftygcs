import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SerialChooserModal from './SerialChooserModal'

// ttyS0-ttyS31 are the onboard UART ports every Linux box enumerates
// whether or not anything is wired to them -- never the board somebody
// plugged in -- so they collapse into a "Built-In" disclosure rather than
// burying the real port under two dozen phantom rows.

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
    const toggle = screen.getByRole('button', { name: /Built-In/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('expands and collapses the group on click', () => {
    send([board, ...builtIns])
    const toggle = screen.getByRole('button', { name: /Built-In/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ttyS0')).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('ttyS0')).toBeNull()
  })

  it('sorts every non-ttyS port ahead of the Built-In group', () => {
    send([...builtIns, board])
    const names = screen.getAllByText(/^ttyA|^Built-In/).map((el) => el.textContent)
    expect(names[0]).toBe('ttyACM0')
  })

  it('auto-opens the group when the only port is one of its own', () => {
    send(builtIns)
    // list[0] is picked as the default selection, and it is a ttyS* port
    // here, so hiding it behind a collapsed disclosure would hide the
    // selection Connect is about to act on.
    const toggle = screen.getByRole('button', { name: /Built-In/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ttyS0')).toBeTruthy()
  })

  it('does not offer a Built-In group when there are no ttyS* ports', () => {
    send([board])
    expect(screen.queryByRole('button', { name: /Built-In/ })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /Built-In/ }))
    fireEvent.doubleClick(screen.getByText('ttyS1'))
    expect(chosen).toBe('s1')
  })

  it('closes the chooser the same way a single Connect click does', () => {
    send([board])
    fireEvent.doubleClick(screen.getByText('ttyACM0'))
    expect(screen.queryByText('Select serial port')).toBeNull()
  })
})

describe('Connect button', () => {
  it('still sends whichever port is selected', () => {
    send([board, ...builtIns])
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(chosen).toBe('a')
  })
})
