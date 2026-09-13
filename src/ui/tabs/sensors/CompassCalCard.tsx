import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import ParamField from '../../components/ParamField'
import CompassPriority from './CompassPriority'
import CompassCalWizard from './CompassCalWizard'
import WriteFeedback from '../../components/WriteFeedback'
import RebootPrompt from '../../components/RebootPrompt'
import { useParamStore } from '../../../stores/param-store'

// The compass: which ones the vehicle has, in what order, and the settings
// that apply to all of them. The calibration itself is a dialog
// (`CompassCalWizard`), the way the accelerometer's is -- a procedure with a
// beginning and an end does not belong in a list of settings, and a card that
// swapped its button for attitude tiles, then progress bars, then a verdict
// changed height four times a run under whatever somebody was reading.
export default function CompassCalCard() {
  const entries = useParamStore((s) => s.entries)
  const [calibrating, setCalibrating] = useState(false)

  // `use_for_yaw` is the precondition this screen can see. Absent parameters
  // are not "not used" -- a vehicle that never reported COMPASS_USE is not
  // one we can make this claim about, so the button stays live for it.
  const useParams = ['COMPASS_USE', 'COMPASS_USE2', 'COMPASS_USE3'].filter((p) => entries.has(p))
  const anyUsed = useParams.length === 0 || useParams.some((p) => entries.get(p)?.value !== 0)

  // What you set, then what you do, as on the accelerometer card above it.
  // One card, not two: calibration and "which compass, in what order, and is
  // it used" are one subject.
  return (
    <LaCard title="Compass" className="compass-card">
      <CompassPriority />
      <ParamField param="COMPASS_ENABLE" label="Enable compasses" writeNow />
      <ParamField param="COMPASS_AUTODEC" label="Auto declination" writeNow />
      <ParamField param="COMPASS_LEARN" label="Learn offsets in flight" writeNow />
      <RebootPrompt />
      <div className="la-row">
        <LaButton variant="secondary" disabled={!anyUsed} onClick={() => setCalibrating(true)}>
          Calibrate compass
        </LaButton>
        <span className="la-grow" />
        <WriteFeedback />
      </div>
      {/* ArduPilot refuses to calibrate a compass it is not using --
          `_start_calibration` returns false on `!use_for_yaw(i)`, and
          silently: no STATUSTEXT, just MAV_RESULT_FAILED. So the one
          precondition this screen can see, it checks, rather than offering a
          button whose only outcome is a refusal. */}
      {!anyUsed && <LaHint>No compass is set to Use, so there is nothing to calibrate.</LaHint>}

      {calibrating && <CompassCalWizard onClose={() => setCalibrating(false)} />}
    </LaCard>
  )
}
