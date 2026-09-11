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
      <NeedsVehicle
        title="Radio"
        body="Receiver calibration, stick mapping, and auxiliary switch functions."
      />
    )
  }

  const auxChannels: number[] = []
  for (let n = AUX_FIRST; n <= AUX_LAST; n++) {
    if (entries.has(`RC${n}_OPTION`)) auxChannels.push(n)
  }

  return (
    <>
      <RadioCalCard />
      <ParamCard
        title="Stick mapping"
        note="Edit these by hand only if the transmitter cannot be remapped instead; changes take effect after a reboot."
        fields={[
          { param: 'RCMAP_ROLL', label: 'Roll channel' },
          { param: 'RCMAP_PITCH', label: 'Pitch channel' },
          { param: 'RCMAP_THROTTLE', label: 'Throttle channel' },
          { param: 'RCMAP_YAW', label: 'Yaw channel' },
        ]}
      />
      {auxChannels.length > 0 && (
        <LaCard
          title="Auxiliary functions"
          note="Each switch channel can trigger one function. The flight-mode channel is set on the Flight modes tab."
        >
          <div className="aux-grid aux-grid--head">
            <span>Channel</span>
            <span>Function</span>
          </div>
          {auxChannels.map((n) => (
            <div className="aux-grid" key={n}>
              <span className="aux-grid__label">
                RC{n}
                {channelLabels[n] && <span className="aux-grid__product">{channelLabels[n]}</span>}
              </span>
              <ParamField param={`RC${n}_OPTION`} label={`Channel ${n} function`} bare />
            </div>
          ))}
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
