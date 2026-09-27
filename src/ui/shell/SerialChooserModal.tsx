import { useEffect, useRef, useState } from 'react'
import { LaButton, LaModal } from '../components/La'

/**
 * The onboard UARTs Linux always enumerates (ttyS0 upward, often 32 of them)
 * whether or not anything is wired to them. A USB flight controller shows up
 * as ttyACM* or ttyUSB*. Collapsed rather than dropped, since on a Raspberry
 * Pi ttyS0 is the header UART a flight controller is often wired to.
 */
const isBuiltIn = (p: SerialPortChoice) => /^ttyS\d+$/i.test(p.portName || p.portId)

/** The first row as drawn, which is not the OS's first: built-in ports go last. */
const topRow = (list: SerialPortChoice[]) =>
  (list.find((p) => !isBuiltIn(p)) ?? list[0])?.portId ?? ''

// Electron's Web Serial chooser; in a browser the browser draws its own.
// The main process's select-serial-port handler defers to this modal.
export default function SerialChooserModal() {
  const [ports, setPorts] = useState<SerialPortChoice[] | null>(null)
  const [selected, setSelected] = useState('')
  // Explicit open/closed state for the Built-in group once clicked; until then
  // it follows the selection.
  const [builtInOverride, setBuiltInOverride] = useState<boolean | null>(null)
  // Whether the user picked the selection, as opposed to the default. A ref
  // because the listener below is registered once.
  const picked = useRef(false)

  // Main re-sends the list whenever a port appears or disappears. A port the
  // user picked is kept if still present; an unpicked default follows the top
  // row, so a board plugged in later wins over a ttyS0 default. Main can also
  // end the request itself when it auto-picks.
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
  // Connect acts only on a visible row, not one hidden in a collapsed group.
  const selectedShown =
    ports.some((p) => p.portId === selected) &&
    (builtInOpen || !builtIn.some((p) => p.portId === selected))

  const row = (p: SerialPortChoice) => (
    <label
      className={`la-radio serial-port${selected === p.portId ? ' is-selected' : ''}`}
      key={p.portId}
      // Double click connects to the port under the pointer, not whatever
      // `selected` holds at that moment.
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
        // One port per row. Built-in ttyS* ports collapse into a group below
        // the rest.
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
 * USB ids as four hex digits. Electron builds these strings from Chromium's
 * uint16 ids, so they arrive in decimal ("4617", not "1209"). An all-digit
 * string is read as decimal; one containing a-f can only be hex.
 */
export function hex(id: string | undefined): string | null {
  if (!id) return null
  const n = /[a-f]/i.test(id) ? parseInt(id, 16) : Number(id)
  if (!Number.isFinite(n) || n <= 0) return null
  return n.toString(16).padStart(4, '0').toUpperCase()
}

/**
 * What this port is, in words: the OS product string, except for the ST DFU
 * bootloader, which reports itself as a bare "STM32 BOOTLOADER".
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
 * USB ids and serial number. Not shown on the chooser: the ids identify a
 * model rather than a board, so they cannot tell two interfaces or two
 * identical boards apart.
 */
export function usbIds(p: SerialPortChoice): string | null {
  const vid = hex(p.vendorId)
  const pid = hex(p.productId)
  const bits: string[] = []
  if (vid && pid) bits.push(`USB ${vid}:${pid}`)
  if (p.serialNumber) bits.push(`SN ${p.serialNumber}`)
  return bits.length ? bits.join(' · ') : null
}
