import { useEffect, useState } from 'react'
import { LaButton, LaModal } from '../components/La'

// Electron's Web Serial chooser. In a browser the browser draws its own
// picker; in Electron the select-serial-port handler defers to us so the
// chooser matches the house style. Radio-shaped because it is an exclusive
// choice (DESIGN.md: radios are dots, not switches).
export default function SerialChooserModal() {
  const [ports, setPorts] = useState<{ portId: string; portName: string }[] | null>(null)
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
        <div className="la-radio-group">
          {ports.map((p) => (
            <label className="la-radio" key={p.portId}>
              <input
                type="radio"
                name="serial-port"
                checked={selected === p.portId}
                onChange={() => setSelected(p.portId)}
              />
              <span className="la-radio__mark"></span>
              {p.portName || p.portId}
            </label>
          ))}
        </div>
      )}
    </LaModal>
  )
}
