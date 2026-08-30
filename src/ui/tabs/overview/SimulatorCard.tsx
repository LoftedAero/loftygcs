import { useEffect, useState } from 'react'
import { LaButton, LaCard, LaField, LaHint, LaSelect } from '../../components/La'
import { useSimStore } from '../../../stores/sim-store'
import { useConnectionStore } from '../../../stores/connection-store'
import {
  connectExternalSimulator,
  installSimulator,
  simulatorAvailable,
  startSimulator,
  stopSimulator,
  subscribeSimEvents,
} from '../../../services/simulator'

// Run real ArduPilot instead of the built-in demo vehicle. Desktop only --
// a browser cannot start a process, and there is no WebAssembly build of
// ArduPilot to run in the page instead.
export default function SimulatorCard() {
  const status = useSimStore((s) => s.status)
  const phase = useSimStore((s) => s.phase)
  const progress = useSimStore((s) => s.progress)
  const error = useSimStore((s) => s.error)
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const [vehicle, setVehicle] = useState('copter')

  useEffect(() => subscribeSimEvents(), [])

  if (!simulatorAvailable()) return null

  const busy = phase === 'installing' || phase === 'starting'
  const running = phase === 'running' || status?.running != null
  const installed = status?.installed ?? []
  const isInstalled = installed.includes(vehicle)

  return (
    <LaCard
      title="Simulator"
      note={
        status?.supported
          ? 'Runs the real ArduPilot firmware locally — the full parameter set, real arming checks, and real flight modes.'
          : 'Prebuilt SITL binaries are published for Windows only. Run sim_vehicle.py yourself and connect to it below.'
      }
    >
      {status?.supported && (
        <>
          <LaField label="Vehicle" htmlFor="sim-vehicle">
            <LaSelect
              id="sim-vehicle"
              value={vehicle}
              disabled={busy || running}
              onChange={(e) => setVehicle(e.target.value)}
            >
              {status.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {installed.includes(v.id) ? '' : ' (not installed)'}
                </option>
              ))}
            </LaSelect>
          </LaField>
          <div className="la-row">
            {!isInstalled && (
              <LaButton
                variant="secondary"
                disabled={busy}
                onClick={() => void installSimulator(vehicle)}
              >
                {phase === 'installing' ? 'Downloading…' : 'Install simulator'}
              </LaButton>
            )}
            {isInstalled && !running && (
              <LaButton
                variant="secondary"
                disabled={busy || connected}
                onClick={() => void startSimulator(vehicle)}
              >
                {phase === 'starting' ? 'Starting…' : 'Start simulator'}
              </LaButton>
            )}
            {running && (
              <LaButton variant="ghost" onClick={() => void stopSimulator()}>
                Stop simulator
              </LaButton>
            )}
          </div>
          {progress && (
            <LaHint>
              {progress.file} ({progress.done}/{progress.total})
            </LaHint>
          )}
          {!isInstalled && !busy && (
            <LaHint>About 20 MB, downloaded once from firmware.ardupilot.org.</LaHint>
          )}
          {connected && !running && (
            <LaHint>Disconnect the current vehicle before starting the simulator.</LaHint>
          )}
        </>
      )}
      <div className="la-row">
        <LaButton
          variant="ghost"
          disabled={connected}
          title="Attach to a SITL you started yourself, on TCP 5760"
          onClick={() => void connectExternalSimulator()}
        >
          Connect to a running simulator
        </LaButton>
      </div>
      <LaHint error>{error}</LaHint>
    </LaCard>
  )
}
