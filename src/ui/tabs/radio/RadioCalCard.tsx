import { useEffect, useState } from 'react'
import { LaButton, LaCard } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import ChannelMonitor from './ChannelMonitor'
import RadioCalWizard from './RadioCalWizard'
import { STICK_FUNCTIONS, STICK_SPECS, type Mapping, type StickFunction } from './radio-cal'

/** RC_CHANNELS carries eighteen; sixteen is what RCn_OPTION reaches. */
const CHANNEL_SLOTS = 16
/** How long "Calibration saved" stays, as "Level set" does on Sensors. */
const SAVED_STATUS_MS = 4000

// Live receiver input plus the entry to calibration. The mapping is read
// from RCMAP_*/RCn_REVERSED rather than remembered from a calibration run,
// so it reflects the vehicle on a fresh connection.
export default function RadioCalCard() {
  const channels = useVehicleStore((s) => s.rcChannels)
  const entries = useParamStore((s) => s.entries)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  // The saved note clears itself after a few seconds.
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), SAVED_STATUS_MS)
    return () => clearTimeout(t)
  }, [saved])

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
      {/* Safety instructions (transmitter on, props off) are given by the
          wizard when they matter, not on the card. */}
      <LaCard
        title="Channels"
        actions={
          <>
            {/* The dialog closes itself on a clean write and leaves this note
                beside the button that started it. */}
            {saved && (
              <span className="card-status card-status--ok" role="status">
                Calibration saved
              </span>
            )}
            <LaButton
              variant="secondary"
              disabled={channels.length === 0}
              onClick={() => setWizardOpen(true)}
            >
              Calibrate radio
            </LaButton>
          </>
        }
      >
        <ChannelMonitor channels={channels} mapping={mapping} slots={CHANNEL_SLOTS} />
      </LaCard>
      <RadioCalWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={() => setSaved(true)}
      />
    </>
  )
}
