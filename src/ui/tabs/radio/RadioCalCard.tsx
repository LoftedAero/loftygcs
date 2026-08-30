import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import ChannelMonitor from './ChannelMonitor'
import RadioCalWizard from './RadioCalWizard'
import { STICK_FUNCTIONS, STICK_SPECS, type Mapping, type StickFunction } from './radio-cal'

// Live input plus the way in to the calibration. The mapping shown here is
// read back from RCMAP_*/RCn_REVERSED rather than remembered from a
// calibration run, so it reflects the vehicle even on a fresh connection.
export default function RadioCalCard() {
  const channels = useVehicleStore((s) => s.rcChannels)
  const entries = useParamStore((s) => s.entries)
  const paramsReady = useParamStore((s) => s.loadState === 'ready')
  const { channelLabels } = useProfileLabels()
  const [wizardOpen, setWizardOpen] = useState(false)

  const mapping: Partial<Record<StickFunction, Mapping>> = {}
  for (const fn of STICK_FUNCTIONS) {
    const channel = entries.get(STICK_SPECS[fn].rcmapParam)?.value
    if (!channel) continue
    mapping[fn] = {
      channel,
      reversed: (entries.get(`RC${channel}_REVERSED`)?.value ?? 0) !== 0,
    }
  }

  return (
    <>
      <LaCard
        title="Radio"
        note="Live receiver input. Calibrate with the transmitter on, the vehicle disarmed, and the propellers off."
      >
        <ChannelMonitor channels={channels} mapping={mapping} labels={channelLabels} />
        <div className="la-row">
          <LaButton
            variant="secondary"
            disabled={channels.length === 0 || !paramsReady}
            onClick={() => setWizardOpen(true)}
          >
            Calibrate radio…
          </LaButton>
        </div>
        {channels.length > 0 && !paramsReady && <LaHint>Waiting for parameters…</LaHint>}
      </LaCard>
      <RadioCalWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </>
  )
}
