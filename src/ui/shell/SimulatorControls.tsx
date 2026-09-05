import { useState } from 'react'
import { LaButton, LaField, LaHint, LaInput, LaSelect } from '../components/La'
import { useSimStore } from '../../stores/sim-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useMissionStore } from '../../stores/mission-store'
import { CMAC_HOME, parseHome } from '../../sim-home'
import {
  connectExternalSimulator,
  installSimulator,
  startSimulator,
  stopSimulator,
} from '../../services/simulator'

// Run real ArduPilot instead of the built-in demo vehicle. Desktop only --
// a browser cannot start a process, and there is no WebAssembly build of
// ArduPilot to run in the page instead.
//
// The event subscription lives in SimTray, not here: the panel unmounts
// every time it is dismissed, and a simulator that stopped reporting its
// state because nobody had the tray open would be worse than no tray.

export default function SimulatorControls({ onStarted }: { onStarted?: () => void }) {
  const status = useSimStore((s) => s.status)
  const phase = useSimStore((s) => s.phase)
  const progress = useSimStore((s) => s.progress)
  const error = useSimStore((s) => s.error)
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const [vehicle, setVehicle] = useState('copter')
  const homeText = useSimStore((s) => s.homeText)
  const setHomeText = useSimStore((s) => s.setHomeText)
  const plannedHome = useMissionStore((s) => s.plan.home)

  const busy = phase === 'installing' || phase === 'starting'
  const running = phase === 'running' || status?.running != null
  const installed = status?.installed ?? []
  const isInstalled = installed.includes(vehicle)

  // Empty means CMAC, the field sim_vehicle.py boots at -- the same vehicle
  // every ArduPilot user has seen, which is the right thing to get when you
  // have not asked for anything else.
  const parsed = homeText.trim() ? parseHome(homeText) : { home: CMAC_HOME }
  const homeError = 'error' in parsed ? parsed.error : null
  const home = 'home' in parsed ? parsed.home : null

  return (
    <>
      <h3 className="app-simtray__head">Simulator</h3>
      <p className="app-simtray__note">
        {status?.supported
          ? 'Real ArduPilot firmware, running locally — the full parameter set, real arming checks, real mode logic.'
          : 'Prebuilt SITL binaries are published for Windows only. Run sim_vehicle.py yourself and connect to it below.'}
      </p>

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
          {/* Home is read at boot, so this is deliberately not a live
              setting: changing it takes effect the next time the simulator
              starts. Disabled while one is running, to say so. */}
          <LaField label="Home location" htmlFor="sim-home">
            <LaInput
              id="sim-home"
              type="text"
              inputMode="decimal"
              placeholder="-35.363262, 149.165237, 584, 270"
              disabled={busy || running}
              value={homeText}
              onChange={(e) => setHomeText(e.target.value)}
            />
          </LaField>
          {homeError ? (
            <LaHint error>{homeError}</LaHint>
          ) : (
            <LaHint>
              Latitude and longitude, and optionally an altitude in meters and a heading in degrees.
              Empty boots at CMAC, ArduPilot&rsquo;s usual test field.
            </LaHint>
          )}
          <div className="la-row">
            {/* Plan at your field on the map, then boot the simulator there.
                Only offered once there is a planned home to copy. */}
            {plannedHome && !running && (
              <LaButton
                variant="ghost"
                disabled={busy}
                title="Copy the planned home from the mission map"
                onClick={() =>
                  setHomeText(
                    `${(plannedHome.x / 1e7).toFixed(7)}, ${(plannedHome.y / 1e7).toFixed(7)}` +
                      `, ${Math.round(plannedHome.z)}`,
                  )
                }
              >
                Use planned home
              </LaButton>
            )}
            {homeText.trim() !== '' && !running && (
              <LaButton variant="ghost" disabled={busy} onClick={() => setHomeText('')}>
                Reset to default
              </LaButton>
            )}
          </div>
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
                disabled={busy || connected || !home}
                onClick={() => {
                  void startSimulator(vehicle, home ?? undefined)
                  // Out of the way: what happens next is on the screen
                  // behind this panel, not in it.
                  onStarted?.()
                }}
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
          onClick={() => {
            void connectExternalSimulator()
            onStarted?.()
          }}
        >
          Connect to a running simulator
        </LaButton>
      </div>
      <LaHint error>{error}</LaHint>
    </>
  )
}
