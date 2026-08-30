import { LaCard } from '../../components/La'
import ParamField from '../../components/ParamField'
import { NeedsVehicle } from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'

// Serial port assignment. This tab earns its place ahead of Sensors: a GPS
// or external compass on a port whose protocol is wrong is simply not
// detected, and every downstream calibration then fails for a reason the
// user cannot see.
const MAX_SERIAL = 8

export default function PortsTab() {
  const entries = useParamStore((s) => s.entries)
  const ready = useParamStore((s) => s.loadState === 'ready')

  if (!ready) {
    return (
      <NeedsVehicle
        title="Ports"
        body="Protocol and baud rate for each serial port: telemetry radios, GPS, companion computers, and peripherals."
      />
    )
  }

  const ports: number[] = []
  for (let n = 0; n < MAX_SERIAL; n++) {
    if (entries.has(`SERIAL${n}_PROTOCOL`)) ports.push(n)
  }

  if (ports.length === 0) {
    return (
      <LaCard title="Serial ports" note="This vehicle reports no serial port parameters.">
        <p className="app-placeholder">
          Every SERIALn_* parameter remains reachable on the Parameters tab.
        </p>
      </LaCard>
    )
  }

  return (
    <LaCard
      title="Serial ports"
      note="SERIAL0 is the USB console. Changing a protocol needs a reboot before the peripheral is detected."
    >
      <div className="ports-grid ports-grid--head">
        <span>Port</span>
        <span>Protocol</span>
        <span>Baud</span>
        <span>Options</span>
      </div>
      {ports.map((n) => (
        <div className="ports-grid" key={n}>
          <span className="ports-grid__label">
            SERIAL{n}
            {n === 0 && <span className="ports-grid__hint">USB</span>}
          </span>
          <ParamField param={`SERIAL${n}_PROTOCOL`} label="Protocol" bare />
          <ParamField param={`SERIAL${n}_BAUD`} label="Baud" bare />
          <ParamField param={`SERIAL${n}_OPTIONS`} label="Options" bare />
        </div>
      ))}
    </LaCard>
  )
}
