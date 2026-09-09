import { useEffect, useState } from 'react'
import { LaButton, LaModal } from '../components/La'

// Electron's Web Serial chooser. In a browser the browser draws its own
// picker; in Electron the select-serial-port handler defers to us so the
// chooser matches the house style. Radio-shaped because it is an exclusive
// choice (DESIGN.md: radios are dots, not switches).
export default function SerialChooserModal() {
  const [ports, setPorts] = useState<SerialPortChoice[] | null>(null)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    return window.loftgcs?.serialPicker.onPortsAvailable((list) => {
      setPorts(list)
      setSelected(list[0]?.portId ?? '')
    })
  }, [])

  if (!ports) return null

  const done = () => setPorts(null)

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
            disabled={ports.length === 0}
            onClick={() => {
              window.loftgcs?.serialPicker.choose(selected)
              done()
            }}
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
        // port name above it always does.
        <div className="serial-list">
          {ports.map((p) => (
            <label
              className={`la-radio serial-port${selected === p.portId ? ' is-selected' : ''}`}
              key={p.portId}
            >
              <input
                type="radio"
                name="serial-port"
                checked={selected === p.portId}
                onChange={() => setSelected(p.portId)}
              />
              <span className="la-radio__mark"></span>
              <span className="serial-port__text">
                <span className="serial-port__name">{p.portName || p.portId}</span>
                {describePort(p) && <span className="serial-port__desc">{describePort(p)}</span>}
              </span>
            </label>
          ))}
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
