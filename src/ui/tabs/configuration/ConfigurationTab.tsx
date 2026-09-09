import { useState } from 'react'
import { LaButton, LaCard, LaField, LaReadout } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'
import { useGuideStore } from '../../../stores/guide-store'
import { profileById } from '../../../profiles'
import GuideBrowserModal from '../../guides/GuideBrowserModal'

// The one entry to tailored, product-specific setup. It lives here because
// "what aircraft is this" is a configuration question; a user without one of
// these airframes never needs to open it.
function AircraftCard() {
  const [browserOpen, setBrowserOpen] = useState(false)
  const selectedId = useGuideStore((s) => s.selectedProfileId)
  const selected = selectedId ? profileById(selectedId) : null
  return (
    <LaCard
      title="Guided setup"
      note={
        selected
          ? `Output and channel names for the ${selected.name} are shown across the app.`
          : 'Step-by-step setup sequences, generic or specific to a known aircraft.'
      }
    >
      <LaField label="Aircraft">
        <LaReadout placeholder="Not set" value={selected?.name} />
      </LaField>
      <div className="la-row">
        <LaButton variant="ghost" onClick={() => setBrowserOpen(true)}>
          Guided setups
        </LaButton>
      </div>
      {browserOpen && <GuideBrowserModal onClose={() => setBrowserOpen(false)} />}
    </LaCard>
  )
}

// What the airframe *is*: frame geometry and how the board sits in it.
// These are the settings that change the meaning of everything else, which
// is why they come first in the rail after firmware.
export default function ConfigurationTab() {
  const ready = useParamStore((s) => s.loadState === 'ready')
  if (!ready) {
    return (
      <>
        <NeedsVehicle
          title="Configuration"
          body="Frame class and type, board orientation, and vehicle identity."
        />
        <AircraftCard />
      </>
    )
  }
  return (
    <>
      <AircraftCard />
      <ParamCard
        title="Frame"
        note="Frame class and type must match the airframe before the first arm. Both need a reboot to take effect."
        fields={[
          { param: 'FRAME_CLASS', label: 'Frame class' },
          { param: 'FRAME_TYPE', label: 'Frame type' },
          { param: 'Q_FRAME_CLASS', label: 'VTOL frame class' },
          { param: 'Q_FRAME_TYPE', label: 'VTOL frame type' },
        ]}
      />
      <ParamCard
        title="Board orientation"
        note="Set this to how the autopilot is physically mounted, then calibrate the accelerometer — not the other way round."
        fields={[
          { param: 'AHRS_ORIENTATION', label: 'Autopilot orientation' },
          { param: 'AHRS_TRIM_X', label: 'Trim roll', unit: 'rad' },
          { param: 'AHRS_TRIM_Y', label: 'Trim pitch', unit: 'rad' },
        ]}
      />
      <ParamCard
        title="Estimator"
        fields={[
          { param: 'AHRS_EKF_TYPE', label: 'EKF type' },
          { param: 'EK3_ENABLE', label: 'EKF3 enabled' },
        ]}
      />
      <ParamCard
        title="Identity"
        note="The MAVLink system ID distinguishes vehicles on a shared link."
        fields={[
          { param: 'SYSID_THISMAV', label: 'System ID' },
          { param: 'SYSID_MYGCS', label: 'Ground station ID' },
        ]}
      />
    </>
  )
}
