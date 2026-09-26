import { useEffect, useState } from 'react'
import { LaButton, LaCard } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import ChannelMonitor from './ChannelMonitor'
import RadioCalWizard from './RadioCalWizard'
import { STICK_FUNCTIONS, STICK_SPECS, type Mapping, type StickFunction } from './radio-cal'

/** RC_CHANNELS carries eighteen; sixteen is what RCn_OPTION reaches. */
const CHANNEL_SLOTS = 16
/** How long "Calibration saved" stays, as "Level set" does on Sensors. */
const SAVED_STATUS_MS = 4000

// Live input plus the way in to the calibration. The mapping shown here is
// read back from RCMAP_*/RCn_REVERSED rather than remembered from a
// calibration run, so it reflects the vehicle even on a fresh connection.
//
// Titled "Channels" rather than "Radio": it is what the receiver is sending,
// and a card named after the page it sits on says nothing about itself.
export default function RadioCalCard() {
  const channels = useVehicleStore((s) => s.rcChannels)
  const entries = useParamStore((s) => s.entries)
  const { channelLabels } = useProfileLabels()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  // A result says what happened and then gets out of the way.
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
      {/* The wizard says to switch the transmitter on and take the props off
          at the moment it matters, so the card does not stand there saying
          it. The page is drawn only once parameters are in, so the button
          waits on nothing but receiver input. */}
      <LaCard
        title="Channels"
        actions={
          <>
            {/* Where the calibration ends: the dialog closes itself on a
                clean write, and the word it leaves is beside the button that
                started it. */}
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
        <ChannelMonitor
          channels={channels}
          mapping={mapping}
          labels={channelLabels}
          slots={CHANNEL_SLOTS}
        />
      </LaCard>
      <RadioCalWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={() => setSaved(true)}
      />
    </>
  )
}
