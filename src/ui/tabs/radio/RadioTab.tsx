import { LaCard } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import RadioCalCard from './RadioCalCard'

// Everything about the transmitter link: endpoints, which stick is which,
// and what the auxiliary switches do. Mode selection itself lives on Flight
// modes -- "what can I select" is a different question from "what does this
// switch do".
const AUX_FIRST = 5
const AUX_LAST = 16

export default function RadioTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)
  const { channelLabels } = useProfileLabels()

  if (!connected) {
    return (
      <NeedsVehicle title="Radio" />
    )
  }

  const auxChannels: number[] = []
  for (let n = AUX_FIRST; n <= AUX_LAST; n++) {
    if (entries.has(`RC${n}_OPTION`)) auxChannels.push(n)
  }

  return (
    <>
      <RadioCalCard />
      {/* Remapping at the transmitter is the better fix where the radio
          allows it, and RCMAP changes are read at boot -- the write raises
          the restart prompt itself. */}
      <ParamCard
        title="Stick mapping"
        fields={[
          { param: 'RCMAP_ROLL', label: 'Roll channel' },
          { param: 'RCMAP_PITCH', label: 'Pitch channel' },
          { param: 'RCMAP_THROTTLE', label: 'Throttle channel' },
          { param: 'RCMAP_YAW', label: 'Yaw channel' },
        ]}
      />
      {auxChannels.length > 0 && (
        <LaCard title="Auxiliary functions">
          <div className="app-table">
            <div className="app-table__row aux-grid app-table__head">
              <span>Channel</span>
              <span>Function</span>
            </div>
            {auxChannels.map((n) => (
              <div className="app-table__row aux-grid" key={n}>
                <span className="app-table__label">
                  RC{n}
                  {channelLabels[n] && (
                    <span className="aux-grid__product">{channelLabels[n]}</span>
                  )}
                </span>
                <ParamField param={`RC${n}_OPTION`} label={`Channel ${n} function`} bare />
              </div>
            ))}
          </div>
        </LaCard>
      )}
      <ParamCard
        title="Receiver"
        fields={[
          { param: 'RC_PROTOCOLS', label: 'Protocols' },
          { param: 'RC_OPTIONS', label: 'Options' },
          { param: 'RC_FS_TIMEOUT', label: 'Failsafe timeout', unit: 's' },
        ]}
      />
    </>
  )
}
