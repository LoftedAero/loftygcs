import { useState } from 'react'
import { LaButton, LaCard, LaHint } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { MAV_RESULT } from '../../../protocol/commands'
import AccelCalWizard from './AccelCalWizard'
import CompassCalCard from './CompassCalCard'

const MAV_CMD_PREFLIGHT_CALIBRATION = 241

// Inertial and magnetic calibration. Set board orientation on the
// Configuration tab first -- calibrating around a wrong orientation bakes
// the error into the offsets.
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
    <>
      <AccelCard />
      <CompassCalCard />
      <ParamCard
        title="Compasses"
        note="Disable a compass rather than fighting it: an interference-swamped external mag is worse than none."
        fields={[
          { param: 'COMPASS_USE', label: 'Use compass 1' },
          { param: 'COMPASS_USE2', label: 'Use compass 2' },
          { param: 'COMPASS_USE3', label: 'Use compass 3' },
          { param: 'COMPASS_ORIENT', label: 'Compass 1 orientation' },
          { param: 'COMPASS_AUTODEC', label: 'Auto declination' },
        ]}
      />
      <ParamCard
        title="Filtering"
        note="Lower filter frequencies are calmer but add delay. Change these only with a log to justify it."
        fields={[
          { param: 'INS_GYRO_FILTER', label: 'Gyro filter', unit: 'Hz' },
          { param: 'INS_ACCEL_FILTER', label: 'Accel filter', unit: 'Hz' },
        ]}
      />
    </>
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

  return (
    <LaCard
      title="Accelerometer"
      note="Full calibration holds the vehicle in six orientations; level trim only needs it sitting the way it flies."
    >
      <div className="la-row">
        <LaButton variant="secondary" onClick={() => setWizardOpen(true)}>
          Calibrate accelerometer…
        </LaButton>
        <LaButton variant="ghost" onClick={() => void levelHorizon()}>
          Set level horizon
        </LaButton>
      </div>
      <LaHint>{levelState}</LaHint>
      {wizardOpen && <AccelCalWizard onClose={() => setWizardOpen(false)} />}
    </LaCard>
  )
}
