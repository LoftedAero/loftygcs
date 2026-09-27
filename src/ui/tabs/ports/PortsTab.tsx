import { LaCard } from '../../components/La'
import ParamField from '../../components/ParamField'
import { NeedsVehicle } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import { useParamStore } from '../../../stores/param-store'

// Serial port assignment. Ahead of Sensors because a GPS or external compass
// on a port with the wrong protocol is not detected at all.
const MAX_SERIAL = 8

export default function PortsTab() {
  const entries = useParamStore((s) => s.entries)
  const ready = useParamStore((s) => s.loadState === 'ready')

  if (!ready) {
    return <NeedsVehicle title="Ports" />
  }

  const ports: number[] = []
  for (let n = 0; n < MAX_SERIAL; n++) {
    if (entries.has(`SERIAL${n}_PROTOCOL`)) ports.push(n)
  }

  if (ports.length === 0) {
    return <LaCard title="Serial ports" note="This vehicle reports no serial port parameters." />
  }

  return (
    // The card spans the grid and takes half the content area, since four
    // columns do not fit one card track. Rows use the same framed table as
    // the compass priority table.
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
            {/* Staged, and sent by the card's Write, so a half-edited port
                never reaches the vehicle. */}
            <ParamField param={`SERIAL${n}_PROTOCOL`} label="Protocol" bare />
            <ParamField param={`SERIAL${n}_BAUD`} label="Baud" bare />
            <ParamField param={`SERIAL${n}_OPTIONS`} label="Options" bare />
          </div>
        ))}
      </div>
    </LaCard>
  )
}
