import { useState } from 'react'
import { LaButton, LaHint } from './La'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import WriteParamsModal from '../shell/WriteParamsModal'
import RebootButton from './RebootButton'

// Write, revert, reload — the three things every page that edits parameters
// needs, in one place so the pages cannot drift apart.
//
// These used to live only in the global footer. They moved onto the pages
// once leaving a page with unwritten edits started asking first: the edits
// belong to the page, so the buttons that send them do too. The footer still
// carries them for the Setup tabs that have no column of their own.

export interface VehicleParamActionsProps {
  /** Heading for the group; pages name it for what they edit. */
  title?: string
}

export default function VehicleParamActions({ title = 'Vehicle' }: VehicleParamActionsProps) {
  const dirtyCount = useParamStore((s) => s.dirtyCount)
  const writeBusy = useParamStore((s) => s.writeBusy)
  const lastWrite = useParamStore((s) => s.lastWrite)
  const metadata = useParamStore((s) => s.metadata)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  // A set read from a file is a document, not an aircraft. Write and Reload
  // are the two buttons that need something on the other end -- exactly the
  // pair Mission Planner greys out, for the same reason. Revert is local and
  // stays live, because reverting an edit to a file is still an edit to a
  // file.
  const fromFile = useParamStore((s) => s.source === 'file')
  const canReachVehicle = connected && !fromFile
  const [confirming, setConfirming] = useState(false)

  const needsReboot = (lastWrite?.written ?? []).some((n) => metadata[n]?.rebootRequired)

  const write = () => {
    setConfirming(false)
    void connectionService.writeDirtyParams().then((result) => {
      useParamStore.getState().setLastWrite(result)
    })
  }

  return (
    <section className="app-col__group">
      <WriteParamsModal open={confirming} onConfirm={write} onCancel={() => setConfirming(false)} />
      <div className="app-col__headrow">
        <h3 className="app-col__head">{title}</h3>
        {dirtyCount > 0 && <span className="mission-badge is-dirty">{dirtyCount} staged</span>}
      </div>
      <LaButton
        variant="primary"
        size="block"
        disabled={dirtyCount === 0 || writeBusy || !canReachVehicle}
        onClick={() => setConfirming(true)}
      >
        {writeBusy ? 'Writing…' : 'Write params'}
      </LaButton>
      <LaButton
        variant="secondary"
        size="block"
        disabled={writeBusy || dirtyCount === 0}
        onClick={() => useParamStore.getState().revertAll()}
      >
        Revert changes
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={writeBusy || !canReachVehicle}
        onClick={() => void connectionService.refreshParams()}
      >
        Reload from vehicle
      </LaButton>
      {!canReachVehicle && (
        <LaHint>
          {fromFile
            ? 'These came from a file. Connect a vehicle to write them to it.'
            : 'Connect a vehicle to write or reload.'}
        </LaHint>
      )}
      {lastWrite && (
        <LaHint error={lastWrite.failed.length > 0}>
          {lastWrite.failed.length > 0
            ? `Wrote ${lastWrite.written.length}; failed: ${lastWrite.failed.join(', ')}`
            : `Wrote ${lastWrite.written.length} parameter${lastWrite.written.length === 1 ? '' : 's'}.`}
        </LaHint>
      )}
      {/* The metadata already knows which parameters the firmware only reads
          at boot, so the page can say when a reboot is the next step rather
          than leaving it to be remembered. */}
      <RebootButton note={needsReboot ? 'Some of what you wrote takes effect on reboot.' : ''} />
    </section>
  )
}
