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
  // Drawn once the parameters are in, as every other Setup tab is: drawn
  // before, Hardware ID needed a "waiting for the parameters" line of its own
  // and the calibration cards filled in under the reader.
  const ready = useParamStore((s) => s.loadState === 'ready')
  if (!connected || !ready) {
    return <NeedsVehicle title="Sensors" />
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
      <LaCard title="Hardware ID">
        <HardwareId />
      </LaCard>
    </div>
  )
}

/**
 * The orientation setting, drawn: the autopilot board as mounted, over an
 * airplane silhouette pointing the vehicle's way forward. A pre-rendered frame per
 * rotation (`npm run cal-art`), in the same visual language as the attitude
 * tiles, because a live airframe with the board inside it was two busy things
 * competing at card size.
 *
 * The slot stays when there is nothing to draw -- a custom rotation, or a
 * vehicle that has not reported the parameter -- so the field beside it does
 * not jump sideways when the picture comes and goes.
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
      // The dropdown beside it already says which rotation; this is the same
      // fact as a picture.
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

  // A result says what happened and then gets out of the way. The busy line
  // stays until there is a result to replace it.
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

  // Actions on the title row, settings in the body -- the same shape on both
  // calibration cards. Orientation is written straight through rather than
  // staged, because it has to be right on the vehicle before a calibration
  // starts, and a pending edit in the Write queue would not be.
  return (
    <LaCard
      title="Accelerometer"
      actions={
        <>
          {/* Right beside the button that produced it. The full text is the
              hover text, because a long failure shortens to fit the row. */}
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
