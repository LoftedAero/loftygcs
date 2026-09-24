import { useEffect, useRef, useState } from 'react'
import { LaButton, LaModal } from '../components/La'

/**
 * The onboard 8250/16550 UART ports Linux always enumerates -- ttyS0
 * upward, often thirty-two of them, whether or not anything is wired to them.
 * A flight controller on USB shows up as ttyACM* or ttyUSB* instead, so on a
 * desktop these only bury it. Collapsed rather than dropped, because they are
 * not always phantoms: on a Raspberry Pi, ttyS0 is the header UART a flight
 * controller is commonly wired to.
 */
const isBuiltIn = (p: SerialPortChoice) => /^ttyS\d+$/i.test(p.portName || p.portId)

/** The first row as drawn, which is not the OS's first: built-in ports go last. */
const topRow = (list: SerialPortChoice[]) =>
  (list.find((p) => !isBuiltIn(p)) ?? list[0])?.portId ?? ''

// Electron's Web Serial chooser. In a browser the browser draws its own
// picker; in Electron the select-serial-port handler defers to us so the
// chooser matches the house style. Radio-shaped because it is an exclusive
// choice (DESIGN.md: radios are dots, not switches).
export default function SerialChooserModal() {
  const [ports, setPorts] = useState<SerialPortChoice[] | null>(null)
  const [selected, setSelected] = useState('')
  // Whether the Built-in group is open, as an explicit override once
  // somebody has clicked it; before that it follows the selection, so the
  // group opens by itself only when a built-in port is all there is.
  const [builtInOverride, setBuiltInOverride] = useState<boolean | null>(null)
  // Whether the selection is somebody's choice or only the default. A ref,
  // because the port listener below is registered once and must read it as
  // it is now.
  const picked = useRef(false)

  // The list is live: main re-sends it whenever a port appears or goes away
  // while the request is open, which is what makes plugging a board in with
  // the chooser already up work. A re-send keeps a port somebody *picked* if
  // it is still there -- resetting on every update would move the dot out
  // from under their cursor each time the bus changed -- but a default nobody
  // chose follows the top row. Otherwise a Linux desktop, whose first port is
  // ttyS0, sat on that phantom while the board plugged in after the chooser
  // opened appeared above it, and Connect opened the phantom. Main can end the
  // request itself, when the answer was a fact.
  useEffect(() => {
    const offPorts = window.loftgcs?.serialPicker.onPortsAvailable((list) => {
      setPorts(list)
      setSelected((cur) =>
        picked.current && list.some((p) => p.portId === cur) ? cur : topRow(list),
      )
    })
    const offDone = window.loftgcs?.serialPicker.onDone(() => setPorts(null))
    return () => {
      offPorts?.()
      offDone?.()
    }
  }, [])

  if (!ports) return null

  const done = () => {
    setPorts(null)
    setBuiltInOverride(null)
    picked.current = false
  }
  const connect = (portId: string) => {
    window.loftgcs?.serialPicker.choose(portId)
    done()
  }

  const others = ports.filter((p) => !isBuiltIn(p))
  const builtIn = ports.filter(isBuiltIn)
  const builtInOpen = builtInOverride ?? builtIn.some((p) => p.portId === selected)
  // Connect acts only on a row that is on screen. Collapsing the group over the
  // selected port leaves the dot inside it, and a button that opens a port
  // nobody can see is the one this chooser must not have.
  const selectedShown =
    ports.some((p) => p.portId === selected) &&
    (builtInOpen || !builtIn.some((p) => p.portId === selected))

  const row = (p: SerialPortChoice) => (
    <label
      className={`la-radio serial-port${selected === p.portId ? ' is-selected' : ''}`}
      key={p.portId}
      // A double click is "connect to this one" -- the port under the
      // pointer, not whatever `selected` happens to hold when the second
      // click's timer fires.
      onDoubleClick={() => connect(p.portId)}
    >
      <input
        type="radio"
        name="serial-port"
        checked={selected === p.portId}
        onChange={() => {
          picked.current = true
          setSelected(p.portId)
        }}
      />
      <span className="la-radio__mark"></span>
      <span className="serial-port__text">
        <span className="serial-port__name">{p.portName || p.portId}</span>
        {describePort(p) && <span className="serial-port__desc">{describePort(p)}</span>}
      </span>
    </label>
  )

  return (
    <LaModal
      open
      title="Select serial port"
      actions={
        <>
          <LaButton
            variant="ghost"
            onClick={() => {
              window.loftgcs?.serialPicker.cancel()
              done()
            }}
          >
            Cancel
          </LaButton>
          <LaButton
            variant="primary"
            disabled={!selectedShown}
            onClick={() => connect(selected)}
          >
            Connect
          </LaButton>
        </>
      }
    >
      {ports.length === 0 ? (
        <p>No serial ports found. Plug the flight controller in over USB.</p>
      ) : (
        // One port per row, not a wrapped set of inline radios: five ports
        // with names and descriptions landed three-then-two in a ragged
        // grid, and a chooser is a list. The vendor and product ids are
        // gone with it -- two boards of the same model share them, so the
        // one line that was supposed to tell them apart never could; the
        // port name above it always does. Anything not named ttyS* sorts to
        // the top as a plain row; the built-in ports collapse into their own
        // disclosure below it, drawn like the Log Review field groups.
        <div className="serial-list">
          {others.map(row)}
          {builtIn.length > 0 && (
            <div className="serial-group">
              <button
                type="button"
                className="serial-group__toggle"
                aria-expanded={builtInOpen}
                onClick={() => setBuiltInOverride(!builtInOpen)}
              >
                <span className="serial-group__caret">{builtInOpen ? '▾' : '▸'}</span>
                Built-in
                <span className="serial-group__count">{builtIn.length}</span>
              </button>
              {builtInOpen && builtIn.map(row)}
            </div>
          )}
        </div>
      )}
    </LaModal>
  )
}

/**
 * USB ids as the four hex digits everyone quotes them in.
 *
 * Electron builds these strings from Chromium's uint16 vendor_id/product_id,
 * so they arrive decimal -- "4617", not "1209". An all-digit string is
 * therefore read as decimal; one containing a-f can only be hex, and is read
 * that way so a platform that does hand back hex is not mangled. There is no
 * reading of "1209" that is right in both, which is why the decimal case has
 * to be the documented one rather than a guess.
 */
export function hex(id: string | undefined): string | null {
  if (!id) return null
  const n = /[a-f]/i.test(id) ? parseInt(id, 16) : Number(id)
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toString(16).padStart(4, '0').toUpperCase()
}

/**
 * What this port is, in words. The OS product string is the honest answer
 * and almost every flight controller supplies one; the single hard-coded
 * case is the DFU bootloader, which the app already recognises by the same
 * ids in order to offer a recovery flash, and which reports itself as a
 * bare "STM32 BOOTLOADER" that means nothing to most people.
 */
export function describePort(p: SerialPortChoice): string | null {
  const vid = hex(p.vendorId)
  const pid = hex(p.productId)
  if (vid === '0483' && pid === 'DF11') return 'STM32 DFU bootloader — for recovery flashing'
  const name = p.displayName?.trim()
  if (!name || name === p.portName) return null
  return name
}

/**
 * The identifying detail, kept for the tests and for whatever needs it next.
 *
 * It is no longer on the chooser. The ids identify a *model*, not a board,
 * so the two rows anyone actually has to choose between -- one flight
 * controller presenting two interfaces, or two of the same aircraft --
 * carried the same string, and the thing that told them apart was the port
 * name already printed above it.
 */
export function usbIds(p: SerialPortChoice): string | null {
  const vid = hex(p.vendorId)
  const pid = hex(p.productId)
  const bits: string[] = []
  if (vid && pid) bits.push(`USB ${vid}:${pid}`)
  if (p.serialNumber) bits.push(`SN ${p.serialNumber}`)
  return bits.length ? bits.join(' · ') : null
}
