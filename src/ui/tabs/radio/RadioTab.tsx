import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import RadioCalCard from './RadioCalCard'

// The transmitter link: what the receiver sends, which stick is which, and
// what the auxiliary switches do. Mode selection lives on Flight modes.
// Copter, Plane and quadplane report the same RC_, RCMAP_ and RCn_OPTION
// set, so the page is the same on all three.
const AUX_FIRST = 5
const AUX_LAST = 16

const REASON = 'Radio changes take effect after a restart'

function card(title: string, fields: ParamFieldSpec[]) {
  const names = new Set(fields.map((f) => f.param))
  return (
    <ParamCard
      title={title}
      showNames
      compact
      fields={fields}
      actions={<CardParamActions reason={REASON} owns={(p) => names.has(p)} />}
    />
  )
}

// Remapping at the transmitter is better where the radio allows it. RCMAP is
// read at boot, so the write raises the restart prompt.
const MAPPING: ParamFieldSpec[] = [
  { param: 'RCMAP_ROLL', label: 'Roll channel' },
  { param: 'RCMAP_PITCH', label: 'Pitch channel' },
  { param: 'RCMAP_THROTTLE', label: 'Throttle channel' },
  { param: 'RCMAP_YAW', label: 'Yaw channel' },
]

const RECEIVER: ParamFieldSpec[] = [
  { param: 'RC_PROTOCOLS', label: 'Protocols' },
  { param: 'RC_OPTIONS', label: 'Options' },
  { param: 'RC_FS_TIMEOUT', label: 'Failsafe timeout' },
]

// One row per aux channel.
function auxFields(): ParamFieldSpec[] {
  const fields: ParamFieldSpec[] = []
  for (let n = AUX_FIRST; n <= AUX_LAST; n++) {
    fields.push({ param: `RC${n}_OPTION`, label: `Channel ${n}` })
  }
  return fields
}

export default function RadioTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')

  if (!connected || !ready) {
    return <NeedsVehicle title="Radio" />
  }

  // Sticks on the left (input, then mapping); switches and receiver on the right.
  return (
    <div className="config-screen config-screen--even">
      <div className="app-stack app-stack--fill">
        <RadioCalCard />
        {card('Stick mapping', MAPPING)}
      </div>
      <div className="app-stack app-stack--fill">
        {card('Auxiliary functions', auxFields())}
        {card('Receiver options', RECEIVER)}
      </div>
    </div>
  )
}
