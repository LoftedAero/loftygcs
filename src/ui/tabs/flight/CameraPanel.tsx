import { useState } from 'react'
import { LaButton, LaSelect, LaSwitch } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { MOUNT_MODES, hasGimbalManager } from '../../../protocol/gimbal'
import { mountMode, photo, point, record, zoomCamera } from '../../../services/camera'

// Pointing the camera while flying.
//
// The angles are preset buttons rather than a slider or a joypad, because
// the four that get used are forward, down, and forty-five each way, and a
// slider is a thing to aim at with a mouse in one hand and an aircraft in
// the air. Fine pointing is what the transmitter is for -- which is why RC
// mode is one click away.
//
// Everything here is ack-verified, and ArduPilot answers every one of these
// commands even with no mount configured. The answer is the only difference
// between "the photo was taken" and "MNT1_TYPE is still zero", so the reply
// is always reported rather than assumed.

/** The angles anyone actually asks for, as pitch in degrees. */
const PITCH_PRESETS = [
  { label: 'Forward', pitch: 0 },
  { label: '−45°', pitch: -45 },
  { label: 'Down', pitch: -90 },
] as const

export default function CameraPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const firmware = useVehicleStore((s) => s.firmware)
  const gimbal = useVehicleStore((s) => s.gimbal)
  const [mode, setMode] = useState(2)
  const [lockYaw, setLockYaw] = useState(false)
  const [recording, setRecording] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const run = (what: string, fn: () => Promise<void>) => {
    setStatus(`${what}…`)
    void fn().then(
      () => setStatus(`${what}: done`),
      (err: unknown) => setStatus(`${what}: ${err instanceof Error ? err.message : String(err)}`),
    )
  }

  return (
    <div className="camera-panel">
      <div className="camera-panel__row">
        <span className="camera-panel__label">Mount</span>
        <LaSelect
          aria-label="Mount mode"
          value={String(mode)}
          disabled={!connected}
          onChange={(e) => {
            const next = Number(e.target.value)
            setMode(next)
            run(MOUNT_MODES.find((m) => m.value === next)?.label ?? 'Mode', () => mountMode(next))
          }}
        >
          {MOUNT_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </LaSelect>

        {PITCH_PRESETS.map((p) => (
          <LaButton
            key={p.label}
            variant="secondary"
            size="sm"
            disabled={!connected}
            onClick={() => run(`Point ${p.label}`, () => point(p.pitch, 0, lockYaw))}
          >
            {p.label}
          </LaButton>
        ))}

        {/* Only the gimbal manager can be told to hold an earth heading;
            the old command has no flag for it, so the switch is not offered
            where it would silently do nothing. */}
        {hasGimbalManager(firmware) && (
          <LaSwitch
            label="Lock yaw"
            checked={lockYaw}
            disabled={!connected}
            onChange={(e) => setLockYaw(e.target.checked)}
          />
        )}

        {/* What it says it is doing, which is not always what it was told. */}
        <span className="camera-panel__readout">
          {gimbal
            ? `${gimbal.pitchDeg.toFixed(0)}° pitch · ${gimbal.yawDeg.toFixed(0)}° yaw`
            : 'no mount'}
        </span>
      </div>

      <div className="camera-panel__row">
        <span className="camera-panel__label">Camera</span>
        <LaButton
          variant="secondary"
          size="sm"
          disabled={!connected}
          onClick={() => run('Photo', photo)}
        >
          Photo
        </LaButton>
        <LaButton
          variant={recording ? 'danger' : 'secondary'}
          size="sm"
          disabled={!connected}
          onClick={() => {
            const start = !recording
            setRecording(start)
            run(start ? 'Record' : 'Stop recording', () => record(start))
          }}
        >
          {recording ? 'Stop' : 'Record'}
        </LaButton>
        {/* Continuous zoom: press to start, release to stop, which is what
            the camera protocol's type 1 means. */}
        <LaButton
          variant="ghost"
          size="sm"
          disabled={!connected}
          onPointerDown={() => run('Zoom in', () => zoomCamera(1))}
          onPointerUp={() => void zoomCamera(0)}
          onPointerLeave={() => void zoomCamera(0)}
        >
          Zoom +
        </LaButton>
        <LaButton
          variant="ghost"
          size="sm"
          disabled={!connected}
          onPointerDown={() => run('Zoom out', () => zoomCamera(-1))}
          onPointerUp={() => void zoomCamera(0)}
          onPointerLeave={() => void zoomCamera(0)}
        >
          Zoom −
        </LaButton>
        {status && <span className="camera-panel__status">{status}</span>}
      </div>
    </div>
  )
}
