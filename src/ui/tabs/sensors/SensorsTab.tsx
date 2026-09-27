import { useEffect, useState } from 'react'
import { LaButton, LaCard } from '../../components/La'
import ParamField from '../../components/ParamField'
import { NeedsVehicle } from '../../components/ParamCard'
import { useConnectionStore } from '../../../stores/connection-store'
import { connectionService } from '../../../services/connection'
import { MAV_RESULT } from '../../../protocol/commands'
import AccelCalWizard from './AccelCalWizard'
import { useParamStore } from '../../../stores/param-store'
import { ROTATION_COUNT, boardRotation } from '../../../protocol/board-rotation'
import boardSheet from './board-orientations.png'
import CompassCalCard from './CompassCalCard'
import HardwareId from './HardwareId'

const MAV_CMD_PREFLIGHT_CALIBRATION = 241

/** Frames per row of `board-orientations.png`; `npm run cal-art` writes it so. */
const BOARD_COLUMNS = 11

/** How long a Set level result stays on the title row. */
const LEVEL_STATUS_MS = 4000

type LevelStatus = { text: string; tone: 'busy' | 'ok' | 'bad' }

// Inertial and magnetic calibration.
export default function SensorsTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  // Drawn once the parameters are in, like every other Setup tab.
  const ready = useParamStore((s) => s.loadState === 'ready')
  if (!connected || !ready) {
    return <NeedsVehicle title="Sensors" />
  }
  return (
    <div className="sensors-screen">
      {/* The two calibrations stack in one column. */}
      <div className="sensors-screen__stack">
        <AccelCard />
        <CompassCalCard />
      </div>
      {/* What the firmware detected, beside the calibrations: a compass that
          will not calibrate is usually one that was never detected. */}
      <LaCard title="Hardware ID">
        <HardwareId />
      </LaCard>
    </div>
  )
}

/**
 * The orientation setting, drawn: the board as mounted over an airplane
 * silhouette, one pre-rendered frame per rotation (`npm run cal-art`).
 *
 * The slot stays when there is nothing to draw (a custom rotation, or no
 * parameter yet) so the field beside it does not shift.
 */
function OrientationView() {
  const value = useParamStore((s) => s.entries.get('AHRS_ORIENTATION')?.value)
  if (value === undefined || boardRotation(value) === null) {
    return <span className="orient-board" aria-hidden="true" />
  }
  const rows = Math.ceil(ROTATION_COUNT / BOARD_COLUMNS)
  const col = value % BOARD_COLUMNS
  const row = Math.floor(value / BOARD_COLUMNS)
  return (
    <span
      className="orient-board"
      // The dropdown beside it already names the rotation.
      aria-hidden="true"
      style={{
        backgroundImage: `url(${boardSheet})`,
        backgroundSize: `${BOARD_COLUMNS * 100}% ${rows * 100}%`,
        backgroundPosition: `${(col / (BOARD_COLUMNS - 1)) * 100}% ${(row / (rows - 1)) * 100}%`,
      }}
    />
  )
}

function AccelCard() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [level, setLevel] = useState<LevelStatus | null>(null)

  // A result clears after a few seconds; the busy line stays until replaced.
  useEffect(() => {
    if (!level || level.tone === 'busy') return
    const t = setTimeout(() => setLevel(null), LEVEL_STATUS_MS)
    return () => clearTimeout(t)
  }, [level])

  const levelHorizon = async () => {
    setLevel({ text: 'Leveling…', tone: 'busy' })
    try {
      // PREFLIGHT_CALIBRATION param5=2: board-level trim, completes in place.
      const result = await connectionService.runCommand(
        MAV_CMD_PREFLIGHT_CALIBRATION,
        [0, 0, 0, 0, 2, 0, 0],
        10000,
      )
      setLevel(
        result === 0
          ? { text: 'Level set', tone: 'ok' }
          : { text: `Level failed: ${MAV_RESULT[result] ?? result}`, tone: 'bad' },
      )
    } catch (err) {
      const why = err instanceof Error && err.message ? `: ${err.message}` : ''
      setLevel({ text: `Level failed${why}`, tone: 'bad' })
    }
  }

  // Orientation writes immediately rather than staging, because it must be
  // correct on the vehicle before a calibration starts.
  return (
    <LaCard
      title="Accelerometer"
      actions={
        <>
          {/* The full text is also the tooltip, since a long failure is
              truncated to fit the row. */}
          {level && (
            <span
              className={`card-status card-status--${level.tone}`}
              role="status"
              title={level.text}
            >
              {level.text}
            </span>
          )}
          <LaButton variant="ghost" onClick={() => void levelHorizon()}>
            Set level
          </LaButton>
          <LaButton variant="secondary" onClick={() => setWizardOpen(true)}>
            Calibrate accelerometer
          </LaButton>
        </>
      }
    >
      <div className="sensor-card">
        <div className="sensor-fields sensor-fields--one">
          <ParamField
            param="AHRS_ORIENTATION"
            label="Flight controller orientation"
            writeNow
            stacked
          />
        </div>
        <OrientationView />
      </div>
      {wizardOpen && <AccelCalWizard onClose={() => setWizardOpen(false)} />}
    </LaCard>
  )
}
