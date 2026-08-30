import { useEffect, useState } from 'react'
import { LaButton, LaLinkButton, LaModal, LaSelect } from '../components/La'
import { BRAND } from '../../brand'
import { useUiStore, type TabId } from '../../stores/ui-store'
import { useParamStore } from '../../stores/param-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import { arm, disarm, setMode, takeoff } from '../../services/flight'
import { modeTable } from '../../protocol/modes'
import { MAV_RESULT } from '../../protocol/commands'

// Setup sections with no parameters to edit: showing them a Write button
// would be offering an action the page cannot produce work for.
const PARAMLESS_TABS = new Set<TabId>(['overview', 'firmware', 'logs'])

// The bottom action bar: per-tab actions on the left, version link on the
// right. Write Params is the one orange action for the tabs that edit
// parameters -- everything those tabs stage goes to the vehicle here.
function ParamActions({ tab }: { tab: TabId }) {
  const dirtyCount = useParamStore((s) => s.dirtyCount)
  const writeBusy = useParamStore((s) => s.writeBusy)
  const loadState = useParamStore((s) => s.loadState)
  if (loadState !== 'ready') return null
  // ...but if edits are staged on another tab, keep the bar: quietly losing
  // sight of unsaved vehicle changes is the worse of the two outcomes.
  if (PARAMLESS_TABS.has(tab) && dirtyCount === 0) return null
  return (
    <>
      <LaButton
        variant="primary"
        size="lg"
        disabled={dirtyCount === 0 || writeBusy}
        onClick={() => {
          void connectionService.writeDirtyParams().then((result) => {
            useParamStore.getState().setLastWrite(result)
          })
        }}
      >
        {writeBusy ? 'Writing…' : `Write Params${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
      </LaButton>
      <LaButton
        variant="ghost"
        disabled={writeBusy || dirtyCount === 0}
        onClick={() => useParamStore.getState().revertAll()}
      >
        Revert
      </LaButton>
      <LaButton
        variant="ghost"
        disabled={writeBusy}
        onClick={() => void connectionService.refreshParams()}
      >
        Refresh
      </LaButton>
    </>
  )
}

function FlightActions() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const customMode = useVehicleStore((s) => s.customMode)
  const armed = useVehicleStore((s) => s.armed)
  const modeNameNow = useVehicleStore((s) => s.modeName)
  const [status, setStatus] = useState('')
  const [confirmForce, setConfirmForce] = useState(false)
  const modes = modeTable(vehicleType)

  const report = (what: string) => (result: number) =>
    setStatus(result === 0 ? '' : `${what}: ${MAV_RESULT[result] ?? result}`)
  const fail = (what: string) => (err: unknown) =>
    setStatus(`${what}: ${err instanceof Error ? err.message : 'no answer'}`)

  const onArmClick = () => {
    if (armed) {
      void disarm().then(report('Disarm')).catch(fail('Disarm'))
    } else {
      void arm()
        .then((result) => {
          if (result === 0) setStatus('')
          else {
            // Refused: offer force-arm behind an explicit danger confirm.
            setStatus(`Arm: ${MAV_RESULT[result] ?? result}`)
            setConfirmForce(true)
          }
        })
        .catch(fail('Arm'))
    }
  }

  return (
    <>
      <LaSelect
        value={String(customMode)}
        disabled={!connected}
        title="Flight mode"
        onChange={(e) => void setMode(Number(e.target.value)).then(report('Mode')).catch(fail('Mode'))}
      >
        {Object.entries(modes).map(([num, name]) => (
          <option key={num} value={num}>
            {name}
          </option>
        ))}
        {modes[customMode] === undefined && <option value={String(customMode)}>{modeNameNow}</option>}
      </LaSelect>
      <LaButton
        variant={armed ? 'danger' : 'primary'}
        size="lg"
        disabled={!connected}
        onClick={onArmClick}
      >
        {armed ? 'Disarm' : 'Arm'}
      </LaButton>
      <LaButton
        variant="secondary"
        disabled={!connected || !armed}
        onClick={() => void takeoff(20).then(report('Takeoff')).catch(fail('Takeoff'))}
      >
        Takeoff 20 m
      </LaButton>
      {status && <span className="la-readout">{status}</span>}
      {confirmForce && (
        <LaModal
          open
          title="Vehicle refused to arm"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setConfirmForce(false)}>
                Cancel
              </LaButton>
              <LaButton
                variant="danger"
                onClick={() => {
                  setConfirmForce(false)
                  void arm(true).then(report('Force arm')).catch(fail('Force arm'))
                }}
              >
                Force arm anyway
              </LaButton>
            </>
          }
        >
          <p>
            The vehicle's arming checks refused ({status || 'see messages'}). Forcing past them
            skips the safeguards that keep a misconfigured vehicle on the ground.
          </p>
        </LaModal>
      )}
    </>
  )
}

export default function ActionBar() {
  const [version, setVersion] = useState(__APP_VERSION__)
  const mode = useUiStore((s) => s.mode)
  const activeTab = useUiStore((s) => s.activeTab)

  useEffect(() => {
    // The packaged Electron app's version is authoritative (it can differ
    // from the bundled build's during development).
    window.loftgcs?.app.getVersion().then(setVersion)
  }, [])

  return (
    <footer className="la-actionbar">
      {/* Staged parameter edits are global, so Write lives in one place for
          every Setup tab rather than appearing and vanishing per screen. */}
      {mode === 'setup' && <ParamActions tab={activeTab} />}
      {mode === 'fly' && <FlightActions />}
      <span className="la-actionbar__spacer"></span>
      <LaLinkButton
        onClick={() => {
          if (window.loftgcs) window.loftgcs.app.openExternal(BRAND.repoUrl)
          else window.open(BRAND.repoUrl, '_blank', 'noopener')
        }}
      >
        {BRAND.name} v{version}
      </LaLinkButton>
    </footer>
  )
}
