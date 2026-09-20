import { LaCard } from '../../components/La'
import ParamField from '../../components/ParamField'
import { NeedsVehicle } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
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
      <NeedsVehicle title="Ports" />
    )
  }

  const ports: number[] = []
  for (let n = 0; n < MAX_SERIAL; n++) {
    if (entries.has(`SERIAL${n}_PROTOCOL`)) ports.push(n)
  }

  if (ports.length === 0) {
    return (
      <LaCard title="Serial ports" note="This vehicle reports no serial port parameters." />
    )
  }

  return (
    // Which port is the USB console is said on the row itself, and the
    // reboot a protocol change needs is raised by the write that needs it.
    //
    // The card spans the grid's tracks and then takes half the content area,
    // which is a Sensors tile's width -- as one ordinary card it sat in a
    // single 460px track with four columns squeezed into the narrowest shape
    // they ever have to take. The rows are framed for the same reason: the
    // compass priority table is one rail item away, and a table drawn two
    // ways reads as two applications.
    <LaCard
      title="Serial ports"
      className="ports-card"
      actions={
        <CardParamActions
          reason="Serial port changes take effect after a restart"
          owns={(param) => /^SERIAL\d+_/.test(param)}
        />
      }
    >
      <div className="app-table">
        <div className="app-table__row ports-grid app-table__head">
          <span>Port</span>
          <span>Protocol</span>
          <span>Baud</span>
          <span>Options</span>
        </div>
        {ports.map((n) => (
          <div className="app-table__row ports-grid" key={n}>
            <span className="app-table__label">
              SERIAL{n}
              {n === 0 && <span className="ports-grid__hint">USB</span>}
            </span>
            {/* Staged like every other curated screen -- the card's own Write
                is what sends them, and a port half-reconfigured mid-edit is
                not a state worth putting on the vehicle. */}
            <ParamField param={`SERIAL${n}_PROTOCOL`} label="Protocol" bare />
            <ParamField param={`SERIAL${n}_BAUD`} label="Baud" bare />
            <ParamField param={`SERIAL${n}_OPTIONS`} label="Options" bare />
          </div>
        ))}
      </div>
    </LaCard>
  )
}
