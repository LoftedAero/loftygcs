import { LaButton, LaHint } from './La'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import { useParamWrite } from './CardParamActions'
import RebootButton from './RebootButton'

// Write, revert, reload -- what a screen with an actions column needs to
// send its parameters, in one place so the columns cannot drift apart.
//
// **The same Write as a card's, kept in view.** It shares the card's
// behavior (`useParamWrite`): "Write (N)" carries the count, where the column
// had a "staged" pill beside a "Write params" button; the same confirmation;
// the same restart dialog when what was written is read at boot, where the
// column had a note under its reboot button; and a scope, so OSD's Write
// sends the OSD's parameters and not an edit staged on another screen. What
// differs is deliberate: the pair is always present rather than appearing
// with the first edit, because the column is the page's one place to write
// from and nothing under it may move.

export interface VehicleParamActionsProps {
  /** Heading for the group; pages name it for what they edit. */
  title?: string
  /** Which parameters this column writes; everything staged when left out. */
  owns?: (param: string) => boolean
  /** The restart dialog's question when what was written is read at boot. */
  reason?: string
}

export default function VehicleParamActions({
  title = 'Vehicle',
  owns,
  reason = 'Parameter changes take effect after a restart',
}: VehicleParamActionsProps) {
  const lastWrite = useParamStore((s) => s.lastWrite)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  // A set read from a file is a document, not an aircraft. Write and Reload
  // are the two buttons that need something on the other end -- exactly the
  // pair Mission Planner greys out, for the same reason. Revert is local and
  // stays live, because reverting an edit to a file is still an edit to a
  // file.
  const fromFile = useParamStore((s) => s.source === 'file')
  const canReachVehicle = connected && !fromFile
  const w = useParamWrite({ reason, owns })

  return (
    <section className="app-col__group">
      {w.modal}
      <h3 className="app-col__head">{title}</h3>
      <LaButton
        variant="primary"
        size="block"
        disabled={w.dirtyCount === 0 || w.writeBusy || !canReachVehicle}
        onClick={w.confirm}
      >
        {w.label}
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={w.writeBusy || w.dirtyCount === 0}
        onClick={w.revert}
      >
        Revert
      </LaButton>
      <LaButton
        variant="ghost"
        size="block"
        disabled={w.writeBusy || !canReachVehicle}
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
      {/* Failures only. A write that went through shows as its count going
          back to plain "Write", as a card's does; one that did not leaves its
          parameters staged, and this names them. */}
      {lastWrite && lastWrite.failed.length > 0 && (
        <LaHint error>
          Wrote {lastWrite.written.length}; failed: {lastWrite.failed.join(', ')}
        </LaHint>
      )}
      <RebootButton />
    </section>
  )
}
