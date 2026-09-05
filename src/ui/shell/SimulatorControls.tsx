import { useState } from 'react'
import { LaButton, LaField, LaHint, LaInput, LaSelect } from '../components/La'
import { useSimStore } from '../../stores/sim-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useMissionStore } from '../../stores/mission-store'
import { CMAC_HOME, parseHome } from '../../sim-home'
import type { SimBuildChoice, SimParams } from '../../types/loftgcs'
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

/** A chosen build, named by what it is rather than where it sits. */
function buildLabel(build: SimBuildChoice): string {
  if (!build.vehicle) return fileName(build.path)
  const name = build.vehicle[0]!.toUpperCase() + build.vehicle.slice(1)
  return build.version ? `${name} ${build.version}` : name
}

function fileName(p: string): string {
  return p.split(/[\/]/).pop() ?? p
}

/**
 * A .parm is a list of values, an eeprom.bin is the whole stored set.
 *
 * Decided from the name rather than asked about, and mirrored in
 * electron/sitl-core.ts where the launch actually uses it -- the renderer
 * needs the same answer to label the choice it just made.
 */
function classifyParamFile(file: string): SimParams {
  return /\.bin$/i.test(file) ? { kind: 'eeprom', path: file } : { kind: 'file', path: file }
}

export default function SimulatorControls({ onStarted }: { onStarted?: () => void }) {
  const status = useSimStore((s) => s.status)
  const phase = useSimStore((s) => s.phase)
  const progress = useSimStore((s) => s.progress)
  const error = useSimStore((s) => s.error)
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const [pickedVehicle, setVehicle] = useState('copter')
  const homeText = useSimStore((s) => s.homeText)
  const setHomeText = useSimStore((s) => s.setHomeText)
  const plannedHome = useMissionStore((s) => s.plan.home)
  const build = useSimStore((s) => s.build)
  const setBuild = useSimStore((s) => s.setBuild)
  const physics = useSimStore((s) => s.physics)
  const setPhysics = useSimStore((s) => s.setPhysics)
  const params = useSimStore((s) => s.params)
  const setParams = useSimStore((s) => s.setParams)

  const busy = phase === 'installing' || phase === 'starting'
  const running = phase === 'running' || status?.running != null
  const installed = status?.installed ?? []
  // A custom build says what it is; the dropdown only decides for the
  // managed ones, where all three are downloadable and none is chosen yet.
  const vehicle = build?.vehicle ?? pickedVehicle
  // Nothing to install when the build came from disk -- it is already there.
  const isInstalled = build != null || installed.includes(vehicle)
  const locked = busy || running

  const paramsFile = params.kind === 'file' || params.kind === 'eeprom' ? params.path : null

  const chooseBuild = async () => {
    const picked = await window.loftgcs?.sim.pickBuild()
    // Cancelling leaves the setup alone rather than falling back to the
    // official build: the dropdown was only a way to reach the picker.
    if (picked) setBuild(picked)
  }

  const chooseParams = async () => {
    const file = await window.loftgcs?.sim.pickParams()
    // A .parm is a list of values and an eeprom.bin is the stored set --
    // different acts, told apart here rather than asked about.
    if (file) setParams(classifyParamFile(file))
  }

  // Empty means CMAC, the field sim_vehicle.py boots at -- the same vehicle
  // every ArduPilot user has seen, which is the right thing to get when you
  // have not asked for anything else.
  const parsed = homeText.trim() ? parseHome(homeText) : { home: CMAC_HOME }
  const homeError = 'error' in parsed ? parsed.error : null
  const home = 'home' in parsed ? parsed.home : null

  return (
    <>
      <h3 className="app-simtray__head">SITL</h3>
      <p className="app-simtray__note">
        {status?.supported
          ? 'Real ArduPilot firmware, running locally — the full parameter set, real arming checks, real mode logic.'
          : 'Prebuilt SITL binaries are published for Windows only. Run sim_vehicle.py yourself and connect to it below.'}
      </p>

      {status?.supported && (
        <>
          <LaField label="Build" htmlFor="sim-build">
            <LaSelect
              id="sim-build"
              value={build ? 'custom' : 'official'}
              disabled={locked}
              onChange={(e) => {
                if (e.target.value === 'official') setBuild(null)
                else void chooseBuild()
              }}
            >
              <option value="official">Official release</option>
              <option value="custom">{build ? buildLabel(build) : 'Custom build…'}</option>
            </LaSelect>
          </LaField>
          {build ? (
            <div className="la-row">
              <LaHint>{build.path}</LaHint>
              <LaButton variant="ghost" disabled={locked} onClick={() => void chooseBuild()}>
                Change…
              </LaButton>
            </div>
          ) : (
            <LaField label="Vehicle" htmlFor="sim-vehicle">
              <LaSelect
                id="sim-vehicle"
                value={vehicle}
                disabled={locked}
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
          )}

          <LaField label="Physics" htmlFor="sim-physics">
            <LaSelect
              id="sim-physics"
              value={physics.kind}
              disabled={locked}
              onChange={(e) =>
                setPhysics(
                  e.target.value === 'flightaxis'
                    ? { kind: 'flightaxis', host: '' }
                    : { kind: 'builtin' },
                )
              }
            >
              <option value="builtin">Built-in model</option>
              <option value="flightaxis">RealFlight</option>
            </LaSelect>
          </LaField>
          {physics.kind === 'flightaxis' && (
            <>
              <LaField label="RealFlight host" htmlFor="sim-rf-host">
                <LaInput
                  id="sim-rf-host"
                  type="text"
                  placeholder="127.0.0.1"
                  disabled={locked}
                  value={physics.host ?? ''}
                  onChange={(e) => setPhysics({ kind: 'flightaxis', host: e.target.value })}
                />
              </LaField>
              {/* The one setting people forget, and the failure it causes --
                  SITL retrying forever -- says nothing about RealFlight. */}
              <LaHint>
                RealFlight must be running with Simulation &rsaquo; Settings &rsaquo; Physics
                &rsaquo; &ldquo;RealFlight Link enabled&rdquo;. Blank means this machine.
              </LaHint>
            </>
          )}

          <LaField label="Parameters" htmlFor="sim-params">
            <LaSelect
              id="sim-params"
              value={params.kind}
              disabled={locked}
              onChange={(e) => {
                const kind = e.target.value
                if (kind === 'keep' || kind === 'wipe') setParams({ kind })
                else void chooseParams()
              }}
            >
              <option value="wipe">Wipe to defaults</option>
              <option value="keep">Keep what is stored</option>
              <option value="file">{paramsFile ? fileName(paramsFile) : 'From a file…'}</option>
            </LaSelect>
          </LaField>
          {paramsFile ? (
            <div className="la-row">
              <LaHint>
                {params.kind === 'eeprom'
                  ? 'A stored parameter set, copied in whole.'
                  : 'Applied over the defaults, with a wipe so it takes.'}
              </LaHint>
              <LaButton variant="ghost" disabled={locked} onClick={() => void chooseParams()}>
                Change…
              </LaButton>
            </div>
          ) : (
            <LaHint>
              {params.kind === 'wipe'
                ? 'Every launch starts from the same known vehicle.'
                : 'Carries on from wherever the last session left the vehicle.'}
            </LaHint>
          )}
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
                  void startSimulator({
                    vehicle,
                    exe: build?.path,
                    home: home ?? undefined,
                    physics,
                    params,
                  })
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
