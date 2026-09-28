import { useState } from 'react'
import { LaButton, LaField, LaHint, LaSelect } from '../components/La'
import { useHomeText, useSimStore } from '../../stores/sim-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useMissionStore } from '../../stores/mission-store'
import { defaultHome, parseHome } from '../../sim-home'
import type { SimBuildChoice, SimParams } from '../../types/loftgcs'
import {
  connectExternalSimulator,
  installSimulator,
  startSimulator,
  stopSimulator,
} from '../../services/simulator'

// Run ArduPilot SITL. Desktop only,
// since a browser cannot start a process.
//
// The event subscription lives in SimTray because this panel unmounts
// whenever it is dismissed.

/** A chosen build, named by what it is rather than where it sits. */
function buildLabel(build: SimBuildChoice): string {
  if (!build.vehicle) return fileName(build.path)
  const name = build.vehicle[0]!.toUpperCase() + build.vehicle.slice(1)
  return build.version ? `${name} ${build.version}` : name
}

/**
 * The Build option's label for a custom build: the vehicle and version read
 * from the binary, plus the file name to tell builds apart. The full path
 * goes in the select's title.
 */
function buildOptionLabel(build: SimBuildChoice): string {
  const file = fileName(build.path)
  const id = buildLabel(build)
  return id === file ? file : `${id} · ${file}`
}

/** Splits on both separators, since paths come from a native file dialog. */
function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/** The folder a path sits in, for opening the next dialog where the last one left off. */
function dirName(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return cut > 0 ? p.slice(0, cut) : ''
}

/**
 * A .parm is a list of values, an eeprom.bin is the whole stored set.
 * Mirrors electron/sitl-core.ts, which uses it at launch.
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
  const homeText = useHomeText()
  const setHomeText = useSimStore((s) => s.setHomeText)
  const plannedHome = useMissionStore((s) => s.plan.home)
  const build = useSimStore((s) => s.build)
  const setBuild = useSimStore((s) => s.setBuild)
  const physics = useSimStore((s) => s.physics)
  const setPhysics = useSimStore((s) => s.setPhysics)
  const params = useSimStore((s) => s.params)
  const setParams = useSimStore((s) => s.setParams)
  const waitingForRealFlight = useSimStore((s) => s.waitingForRealFlight)
  const setFieldPickerOpen = useUiStore((s) => s.setFieldPickerOpen)
  const browseDir = useSimStore((s) => s.browseDir)
  const setBrowseDir = useSimStore((s) => s.setBrowseDir)

  const busy = phase === 'installing' || phase === 'starting'
  const running = phase === 'running' || status?.running != null
  const installed = status?.installed ?? []
  // A custom build names its own vehicle; the dropdown only applies to
  // managed builds.
  const vehicle = build?.vehicle ?? pickedVehicle
  // Nothing to install when the build came from disk.
  const isInstalled = build != null || installed.includes(vehicle)
  const locked = busy || running

  const paramsFile = params.kind === 'file' || params.kind === 'eeprom' ? params.path : null

  const chooseBuild = async () => {
    const picked = await window.loftgcs?.sim.pickBuild(browseDir)
    // Canceling leaves the current setup alone.
    if (!picked) return
    setBuild(picked)
    // An aircraft ships as an executable beside its `<model>/eeprom.bin`, so
    // the parameter picker starts in the build's folder.
    setBrowseDir(dirName(picked.path))
  }

  const chooseParams = async () => {
    const file = await window.loftgcs?.sim.pickParams(browseDir)
    if (!file) return
    setParams(classifyParamFile(file))
    setBrowseDir(dirName(file))
  }

  // With nothing chosen, boot at the physics' default: CMAC for built-in
  // physics (sim_vehicle.py's default), Eli Field for FlightAxis
  // (RealFlight's default scenery). A pick on the map replaces it.
  const parsed = homeText.trim() ? parseHome(homeText) : { home: defaultHome(physics.kind) }
  const homeError = 'error' in parsed ? parsed.error : null
  const home = 'home' in parsed ? parsed.home : null

  return (
    <>
      <h3 className="app-simtray__head">SITL</h3>
      <p className="app-simtray__note">
        {status?.supported
          ? 'Real ArduPilot firmware, running locally.'
          : 'Prebuilt SITL binaries are published for Windows only. Run sim_vehicle.py yourself and connect to it below.'}
      </p>

      {status?.supported && (
        <>
          <LaField label="Build" htmlFor="sim-build">
            <LaSelect
              id="sim-build"
              value={build ? 'custom' : 'official'}
              {...(build ? { title: build.path } : {})}
              disabled={locked}
              onChange={(e) => {
                const picked = e.target.value
                // "Select from file" is an action, not a state. Reset the
                // select now, since a canceled picker triggers no re-render.
                e.target.value = build ? 'custom' : 'official'
                if (picked === 'official') setBuild(null)
                else if (picked === 'pick') void chooseBuild()
              }}
            >
              <option value="official">Official release</option>
              {/* Only rendered when a custom build is loaded; re-choosing a
                  selected option fires no event, so picking another goes
                  through the option below. */}
              {build && <option value="custom">{buildOptionLabel(build)}</option>}
              <option value="pick">Select from file</option>
            </LaSelect>
          </LaField>
          {/* A custom build names its own vehicle. */}
          {!build && (
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
                  e.target.value === 'flightaxis' ? { kind: 'flightaxis' } : { kind: 'builtin' },
                )
              }
            >
              <option value="builtin">Built-in model</option>
              <option value="flightaxis">RealFlight</option>
            </LaSelect>
          </LaField>
          {/* The setting people forget, and its failure does not mention
              RealFlight. */}
          {physics.kind === 'flightaxis' && (
            <LaHint>RealFlight Link must be enabled in RealFlight</LaHint>
          )}

          <LaField label="Parameters" htmlFor="sim-params">
            <LaSelect
              id="sim-params"
              // .parm and eeprom.bin share the 'file' option; a value that
              // matches no option would display the first one instead.
              value={paramsFile ? 'file' : params.kind}
              {...(paramsFile ? { title: paramsFile } : {})}
              disabled={locked}
              onChange={(e) => {
                const picked = e.target.value
                // Same as Build above: reset before the picker opens.
                e.target.value = paramsFile ? 'file' : params.kind
                if (picked === 'keep' || picked === 'wipe') setParams({ kind: picked })
                else if (picked === 'pick') void chooseParams()
              }}
            >
              <option value="wipe">Wipe to defaults</option>
              <option value="keep">Keep what is stored</option>
              {/* Rendered only when a file is loaded, so the entry below
                  stays reachable. */}
              {paramsFile && <option value="file">{fileName(paramsFile)}</option>}
              <option value="pick">Select from file</option>
            </LaSelect>
          </LaField>
          {/* A chosen file needs no hint; its name is in the field. */}
          {!paramsFile && (
            <LaHint>
              {params.kind === 'wipe'
                ? 'Every launch starts from the same known vehicle.'
                : 'Carries on from wherever the last session left the vehicle.'}
            </LaHint>
          )}
          {/* Home is read at boot, so it is disabled while running. It is
              picked on the map rather than typed: a mistyped coordinate still
              parses, and the heading only means anything against the runway
              it lines up with. */}
          <LaField label="Home location" htmlFor="sim-home-pick">
            <div className="app-simtray__stack">
              <LaButton
                id="sim-home-pick"
                variant="secondary"
                disabled={locked}
                onClick={() => setFieldPickerOpen(true)}
              >
                Pick on map
              </LaButton>
              {homeText.trim() !== '' && !running && (
                <LaButton variant="ghost" disabled={busy} onClick={() => setHomeText('')}>
                  Reset to default
                </LaButton>
              )}
            </div>
          </LaField>
          {homeError ? (
            // Only reachable through a hand-edited stored value.
            <LaHint error>{homeError}</LaHint>
          ) : (
            <LaHint>
              {homeText.trim() === '' || !home
                ? `Default — ${physics.kind === 'flightaxis' ? 'Eli Field' : 'CMAC'}`
                : `${home.latDeg.toFixed(6)}, ${home.lonDeg.toFixed(6)} · ${Math.round(home.altM)} m · ${home.headingDeg}°`}
            </LaHint>
          )}
          <div className="la-row">
            {/* Boot the simulator at the mission's planned home. */}
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
          </div>
          <div className="la-row">
            {!isInstalled && (
              <LaButton
                variant="secondary"
                size="block"
                disabled={busy}
                onClick={() => void installSimulator(vehicle)}
              >
                {phase === 'installing' ? 'Downloading…' : 'Install simulator'}
              </LaButton>
            )}
            {isInstalled && !running && (
              <LaButton
                variant="primary"
                size="block"
                disabled={busy || connected || !home}
                onClick={() => {
                  void startSimulator({
                    vehicle,
                    exe: build?.path,
                    home: home ?? undefined,
                    physics,
                    params,
                  })
                  // Close the tray; what happens next is on the main screen.
                  onStarted?.()
                }}
              >
                {phase === 'starting' ? 'Launching…' : 'Launch SITL instance'}
              </LaButton>
            )}
            {running && (
              <LaButton variant="ghost" size="block" onClick={() => void stopSimulator()}>
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
          {waitingForRealFlight && (
            <LaHint>
              The simulator is running and waiting for RealFlight. It sends no telemetry until
              RealFlight is exchanging data, so connect once RealFlight is up with Simulation
              &rsaquo; Settings &rsaquo; Physics &rsaquo; &ldquo;RealFlight Link enabled&rdquo;.
            </LaHint>
          )}
        </>
      )}

      {/* Stacked under Launch: side by side, both labels would have to be
          shortened. */}
      <div className="la-row">
        <LaButton
          variant="ghost"
          size="block"
          disabled={connected}
          title="Attach to a SITL you started yourself, on TCP 5760"
          onClick={() => {
            void connectExternalSimulator()
            onStarted?.()
          }}
        >
          Connect existing instance
        </LaButton>
      </div>
      <LaHint error>{error}</LaHint>
    </>
  )
}
