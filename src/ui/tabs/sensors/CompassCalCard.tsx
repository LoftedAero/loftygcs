import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import ParamField from '../../components/ParamField'
import CompassPriority from './CompassPriority'
import CompassCalWizard from './CompassCalWizard'
import RebootPrompt from '../../components/RebootPrompt'
import { useParamStore } from '../../../stores/param-store'

// The compasses the vehicle has, their priority, and the settings that apply
// to all of them. Calibration runs in a dialog (`CompassCalWizard`), like the
// accelerometer's, so the card does not change shape during a run.
export default function CompassCalCard() {
  const entries = useParamStore((s) => s.entries)
  const [calibrating, setCalibrating] = useState(false)

  // ArduPilot refuses to calibrate a compass not used for yaw. Absent
  // COMPASS_USE parameters are not "not used", so the button stays enabled.
  const useParams = ['COMPASS_USE', 'COMPASS_USE2', 'COMPASS_USE3'].filter((p) => entries.has(p))
  const anyUsed = useParams.length === 0 || useParams.some((p) => entries.get(p)?.value !== 0)

  // Actions on the title row, settings in the body, as on the accelerometer card.
  return (
    <LaCard
      title="Compass"
      className="compass-card"
      actions={
        <>
          {/* The restart reminder left after Later. */}
          <RebootPrompt inline />
          <LaButton variant="secondary" disabled={!anyUsed} onClick={() => setCalibrating(true)}>
            Calibrate compass
          </LaButton>
        </>
      }
    >
      <CompassPriority />
      {/* Settings for every compass, side by side so they read as one group
          separate from the table above. */}
      <div className="sensor-fields">
        <ParamField param="COMPASS_ENABLE" label="Enable compasses" writeNow stacked />
        <ParamField param="COMPASS_AUTODEC" label="Auto declination" writeNow stacked />
        <ParamField param="COMPASS_LEARN" label="Learn offsets in flight" writeNow stacked />
      </div>
      {/* `_start_calibration` fails on `!use_for_yaw(i)` with only
          MAV_RESULT_FAILED and no STATUSTEXT, so say why here. */}
      {!anyUsed && <LaHint>No compass is set to Use.</LaHint>}

      {calibrating && <CompassCalWizard onClose={() => setCalibrating(false)} />}
    </LaCard>
  )
}
