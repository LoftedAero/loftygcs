import { LaButton, LaHint } from './La'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import { useParamWrite } from './CardParamActions'
import RebootButton from './RebootButton'
import { useCompact } from '../compact'

// Write, Revert and Reload for a screen's actions column, shared so the
// columns stay consistent.
//
// Write behaves like a card's (`useParamWrite`): the count in the label, the
// same confirmation, the restart dialog for boot-time parameters, and a scope
// so a screen writes only its own parameters. Unlike a card's, the buttons
// are always present so nothing below them moves.

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
  // A set read from a file is a document, not an aircraft, so Write and
  // Reload are disabled (as Mission Planner does). Revert is local and stays
  // live.
  const fromFile = useParamStore((s) => s.source === 'file')
  const canReachVehicle = connected && !fromFile
  const w = useParamWrite({ reason, owns })

  return (
    <section className="app-col__group">
      {w.modal}
      <h3 className="app-col__head">{title}</h3>
      {/* In compact mode Write is on the pane's toolbar (ToolbarWrite), where
          it stays in view while the column is a closed drawer. */}
      <LaButton
        variant="primary"
        size="block"
        className="app-col__primary"
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
          {fromFile ? 'Connect a vehicle to write these.' : 'Connect a vehicle to write or reload.'}
        </LaHint>
      )}
      {/* Failures only: success shows as the count clearing from Write, and
          failed parameters stay staged and are named here. */}
      {lastWrite && lastWrite.failed.length > 0 && (
        <LaHint error>
          Wrote {lastWrite.written.length}; failed: {lastWrite.failed.join(', ')}
        </LaHint>
      )}
      <RebootButton />
    </section>
  )
}

/**
 * The column's Write, for the pane's toolbar in compact mode, where the column
 * is a drawer. Pass the same scope as the column's VehicleParamActions.
 */
export function ToolbarWrite({
  owns,
  reason = 'Parameter changes take effect after a restart',
}: Pick<VehicleParamActionsProps, 'owns' | 'reason'>) {
  const compact = useCompact()
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const fromFile = useParamStore((s) => s.source === 'file')
  const w = useParamWrite({ reason, owns })
  if (!compact) return null
  return (
    <>
      {w.modal}
      <LaButton
        variant="primary"
        className="app-toolbar-write"
        disabled={w.dirtyCount === 0 || w.writeBusy || !connected || fromFile}
        onClick={w.confirm}
      >
        {w.label}
      </LaButton>
    </>
  )
}
