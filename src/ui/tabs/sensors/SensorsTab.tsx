import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
import { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { MAV_RESULT } from '../../../protocol/commands'
import AccelCalWizard from './AccelCalWizard'
import CompassCalCard from './CompassCalCard'
import HardwareId from './HardwareId'

const MAV_CMD_PREFLIGHT_CALIBRATION = 241

// Inertial and magnetic calibration.
export default function SensorsTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  if (!connected) {
    return (
      <NeedsVehicle
        title="Sensors"
        body="Accelerometer and compass calibration, and which sensors the vehicle uses."
      />
    )
  }
  return (
    <div className="sensors-screen">
      {/* The two calibrations are the work, so they stack in one column and
          are read top to bottom. */}
      <div className="sensors-screen__stack">
        <AccelCard />
        <CompassCalCard />
      </div>
      {/* What the firmware actually found, beside the calibrations that fail
          when it found nothing. It was a view inside the Inspector, three
          groups away in the rail: a compass that will not calibrate is
          usually a compass that was never detected, and nothing about that
          suggests going to look at a message list. Beside *both* of them
          rather than under whichever card happened to be shorter, which is
          where the card grid put it. */}
      <LaCard title="Hardware ID" subtitle="The sensors this firmware has detected.">
        <HardwareId />
      </LaCard>
    </div>
  )
}

function AccelCard() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [levelState, setLevelState] = useState('')

  const levelHorizon = async () => {
    setLevelState('Hold the vehicle still and level…')
    try {
      // PREFLIGHT_CALIBRATION param5=2: board-level trim, completes in place.
      const result = await connectionService.runCommand(
        MAV_CMD_PREFLIGHT_CALIBRATION,
        [0, 0, 0, 0, 2, 0, 0],
        10000,
      )
      setLevelState(result === 0 ? 'Level set.' : `Vehicle said: ${MAV_RESULT[result] ?? result}`)
    } catch (err) {
      setLevelState(err instanceof Error ? err.message : 'failed')
    }
  }

  // What you set, then what you do -- the same order on both calibration
  // cards. Orientation is first because it has to be right before a run:
  // written straight through rather than staged, since a pending edit in the
  // Write queue would not be on the vehicle when the calibration starts.
  return (
    <LaCard title="Accelerometer">
      <ParamField param="AHRS_ORIENTATION" label="Orientation" writeNow />
      <div className="la-row">
        <LaButton variant="secondary" onClick={() => setWizardOpen(true)}>
          Calibrate accelerometer
        </LaButton>
        <LaButton variant="ghost" onClick={() => void levelHorizon()}>
          Set level horizon
        </LaButton>
        <span className="la-grow" />
        {/* In the row rather than in a band of its own: the row is already
            here and already the right height, where a reserved empty line
            was 22px of nothing in the middle of the card. */}
        <WriteFeedback />
      </div>
      <LaHint>{levelState}</LaHint>
      {wizardOpen && <AccelCalWizard onClose={() => setWizardOpen(false)} />}
    </LaCard>
  )
}
