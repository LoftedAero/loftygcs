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

/**
 * What the Build option reads once a custom one is chosen.
 *
 * Both halves earn their place: the vehicle and version were read out of
 * the binary rather than asked for, and are the only thing that says an
 * executable is the aeroplane it claims to be -- while the file name is how
 * anyone with two builds tells them apart. The full path is on the select's
 * title, which is where it goes now that it has no line of its own.
 */
function buildOptionLabel(build: SimBuildChoice): string {
  const file = fileName(build.path)
  const id = buildLabel(build)
  return id === file ? file : `${id} · ${file}`
}

/**
 * Both separators, because the paths here come from a native file dialog.
 *
 * This split on `/` alone and so returned the whole of `C:\rf\ArduPlane.exe`
 * -- every real Windows pick, which is the only platform the prebuilt
 * binaries exist for. The tests used forward slashes and passed.
 */
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
  // A custom build says what it is; the dropdown only decides for the
  // managed ones, where all three are downloadable and none is chosen yet.
  const vehicle = build?.vehicle ?? pickedVehicle
  // Nothing to install when the build came from disk -- it is already there.
  const isInstalled = build != null || installed.includes(vehicle)
  const locked = busy || running

  const paramsFile = params.kind === 'file' || params.kind === 'eeprom' ? params.path : null

  const chooseBuild = async () => {
    const picked = await window.loftgcs?.sim.pickBuild(browseDir)
    // Cancelling leaves the setup alone rather than falling back to the
    // official build: the dropdown was only a way to reach the picker.
    if (!picked) return
    setBuild(picked)
    // The build's folder is where the parameters are: an aircraft ships as
    // an executable beside its `<model>/eeprom.bin`, so choosing the one
    // says where to look for the other.
    setBrowseDir(dirName(picked.path))
  }

  const chooseParams = async () => {
    const file = await window.loftgcs?.sim.pickParams(browseDir)
    // A .parm is a list of values and an eeprom.bin is the stored set --
    // different acts, told apart here rather than asked about.
    if (!file) return
    setParams(classifyParamFile(file))
    setBrowseDir(dirName(file))
  }

  // With nothing chosen, boot where the simulator in use would.
  //
  // For built-in physics that is CMAC, the field sim_vehicle.py opens at and
  // the one every ArduPilot user has seen. For FlightAxis it is Eli Field,
  // because RealFlight's own default scenery *is* Eli Field and a vehicle
  // that boots at CMAC instead is flying Canberra's coordinates over an
  // Illinois runway -- the mismatch home exists to remove. Either is only a
  // default: a pick on the map replaces it and is what gets remembered.
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
              // The full path, which has no line of its own any more.
              {...(build ? { title: build.path } : {})}
              disabled={locked}
              onChange={(e) => {
                const picked = e.target.value
                // "Select from file…" is an action, not a state, and the
                // control must not sit on it: a cancelled picker changes
                // nothing, so nothing would re-render and the select would
                // be left reading an option that is not what is loaded.
                // Put it back now; a successful pick re-renders over this.
                e.target.value = build ? 'custom' : 'official'
                if (picked === 'official') setBuild(null)
                else if (picked === 'pick') void chooseBuild()
              }}
            >
              <option value="official">Official release</option>
              {/* The build in force, named by what it is and which file it
                  is. Only rendered when there is one -- it is a state, and
                  the option below is how a different one is reached, since
                  re-choosing an option already selected fires no event. */}
              {build && <option value="custom">{buildOptionLabel(build)}</option>}
              <option value="pick">Select from file</option>
            </LaSelect>
          </LaField>
          {/* A custom build says which vehicle it is, so there is nothing to
              choose -- and asking would let the two disagree. */}
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
          {/* The one setting people forget, and the failure it causes --
              SITL retrying forever -- says nothing about RealFlight. */}
          {physics.kind === 'flightaxis' && (
            <LaHint>RealFlight Link must be enabled in RealFlight</LaHint>
          )}

          <LaField label="Parameters" htmlFor="sim-params">
            <LaSelect
              id="sim-params"
              // A .parm and an eeprom.bin are two kinds behind one option:
              // the select has no "eeprom" entry, and a value matching no
              // option makes the browser display the first one instead --
              // so picking an EEPROM used to leave "Wipe to defaults" on
              // screen while the launch correctly used the file.
              value={paramsFile ? 'file' : params.kind}
              {...(paramsFile ? { title: paramsFile } : {})}
              disabled={locked}
              onChange={(e) => {
                const picked = e.target.value
                // Same as Build above: the picker is an action, so the
                // control goes back to what is actually loaded before it
                // opens, and a cancel leaves the select telling the truth.
                e.target.value = paramsFile ? 'file' : params.kind
                if (picked === 'keep' || picked === 'wipe') setParams({ kind: picked })
                else if (picked === 'pick') void chooseParams()
              }}
            >
              <option value="wipe">Wipe to defaults</option>
              <option value="keep">Keep what is stored</option>
              {/* A .parm and an eeprom.bin are two kinds behind one entry,
                  told apart by the extension in the name. Rendered only
                  when one is loaded, so the entry below stays reachable. */}
              {paramsFile && <option value="file">{fileName(paramsFile)}</option>}
              <option value="pick">Select from file</option>
            </LaSelect>
          </LaField>
          {/* Only for the two that look alike and behave differently. A
              chosen file needs no gloss: its name is in the field and its
              extension is the difference -- a .bin is the stored set copied
              in whole, a .parm a list applied over the defaults. */}
          {!paramsFile && (
            <LaHint>
              {params.kind === 'wipe'
                ? 'Every launch starts from the same known vehicle.'
                : 'Carries on from wherever the last session left the vehicle.'}
            </LaHint>
          )}
          {/* Home is read at boot, so this is deliberately not a live
              setting: changing it takes effect the next time the simulator
              starts. Disabled while one is running, to say so. */}
          {/* The map is the whole interface to this value now. A text box
              here was asking someone to type four numbers they can only get
              from another window and cannot check by eye -- and it could
              not carry the heading usefully, since a heading is only worth
              anything against the runway it lines up with. What the box did
              well was *show* the chosen location, so that is what the line
              below it does. */}
          {/* Both buttons are one control: setting the home and putting it
              back. They share the field so Reset lands directly under Pick
              at the same width, rather than needing an empty label of its
              own to fake the alignment. */}
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
            // Not reachable by picking on the map, but the home is a
            // string in localStorage and this is the only thing that would
            // explain a hand-edited one that silently does nothing.
            <LaHint error>{homeError}</LaHint>
          ) : (
            // Only the value: what the heading is for is said in the
            // picker, at the moment it is being set, which is the only
            // moment it helps.
            <LaHint>
              {homeText.trim() === '' || !home
                ? `Default — ${physics.kind === 'flightaxis' ? 'Eli Field' : 'CMAC'}`
                : `${home.latDeg.toFixed(6)}, ${home.lonDeg.toFixed(6)} · ${Math.round(home.altM)} m · ${home.headingDeg}°`}
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
              // The one primary action in this panel, and the one that
              // changes what the app is talking to.
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
                  // Out of the way: what happens next is on the screen
                  // behind this panel, not in it.
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

      {/* Stacked under Launch rather than beside it: at the panel's width
          two buttons side by side would each have to lose half their label,
          and these two labels are the whole difference between them. */}
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
