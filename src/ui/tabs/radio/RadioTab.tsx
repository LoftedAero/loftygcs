import ParamCard, { NeedsVehicle, type ParamFieldSpec } from '../../components/ParamCard'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import RadioCalCard from './RadioCalCard'

// Everything about the transmitter link: what the receiver sends, which stick
// is which, and what the auxiliary switches do. Mode selection itself lives
// on Flight modes -- "what can I select" is a different question from "what
// does this switch do". Copter, Plane and a quadplane report the same RC_,
// RCMAP_ and RCn_OPTION set, so the page is the same on all three.
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

// Remapping at the transmitter is the better fix where the radio allows it,
// and RCMAP changes are read at boot -- the write raises the restart prompt
// itself.
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

// Named rows like every other card, where this was the page's one table: a
// Channel/Function header over twelve rows said nothing the row's own label
// and parameter name do not. A product profile's name for a channel rides on
// the label, as it did on the table's.
function auxFields(labels: Record<number, string | undefined>): ParamFieldSpec[] {
  const fields: ParamFieldSpec[] = []
  for (let n = AUX_FIRST; n <= AUX_LAST; n++) {
    const product = labels[n]
    fields.push({
      param: `RC${n}_OPTION`,
      label: product ? `Channel ${n} · ${product}` : `Channel ${n}`,
    })
  }
  return fields
}

export default function RadioTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  const { channelLabels } = useProfileLabels()

  if (!connected || !ready) {
    return <NeedsVehicle title="Radio" />
  }

  // The sticks down the left -- what they send, then which is which -- and the
  // switches and the receiver down the right.
  return (
    <div className="config-screen config-screen--even">
      <div className="app-stack app-stack--fill">
        <RadioCalCard />
        {card('Stick mapping', MAPPING)}
      </div>
      <div className="app-stack app-stack--fill">
        {card('Auxiliary functions', auxFields(channelLabels))}
        {card('Receiver options', RECEIVER)}
      </div>
    </div>
  )
}
