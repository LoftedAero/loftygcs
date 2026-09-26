import { useState } from 'react'
import { LaButton } from './La'
import RebootPrompt from './RebootPrompt'
import WriteParamsModal from '../shell/WriteParamsModal'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { connectionService } from '../../services/connection'

/**
 * Staging, reverting and writing a set of parameters -- the behavior behind
 * every Write button in the app, so a card's title row and a screen's column
 * (`VehicleParamActions`) cannot answer the same question differently: the
 * same count, the same confirmation, the same restart dialog when what was
 * written is read at boot.
 *
 * `owns` scopes the count, the revert and the write, because a screen can
 * hold two cards that both edit parameters, and a button labelled "Write (14)"
 * on one of them must not quietly send the other's edits -- nor count them.
 * Without a scope it is everything staged, anywhere.
 */
export function useParamWrite({
  reason,
  owns,
  onReverted,
}: {
  reason: string
  owns?: ((param: string) => boolean) | undefined
  onReverted?: (() => void) | undefined
}) {
  // A number, not the map: the selector returns a primitive so the row
  // re-renders when the count changes rather than on every parameter that
  // arrives from the vehicle.
  const dirtyCount = useParamStore((s) => {
    if (!owns) return s.dirtyCount
    let n = 0
    for (const [name, e] of s.entries) if (e.dirty && owns(name)) n++
    return n
  })
  const writeBusy = useParamStore((s) => s.writeBusy)
  const [confirming, setConfirming] = useState(false)

  const revert = () => {
    const store = useParamStore.getState()
    if (!owns) {
      store.revertAll()
    } else {
      for (const [name, e] of store.entries) {
        if (e.dirty && owns(name)) store.edit(name, e.origValue)
      }
    }
    onReverted?.()
  }

  const write = () => {
    setConfirming(false)
    void connectionService.writeDirtyParams(owns).then((result) => {
      useParamStore.getState().setLastWrite(result)
      // The prompt only appears when it is owed, and ArduPilot's own metadata
      // is what says so -- a frame class is read at boot, a filter frequency
      // is not -- so the write asks the parameters it just sent rather than
      // this screen keeping a list that would go stale.
      const { metadata } = useParamStore.getState()
      if (result.written.some((n) => metadata[n]?.rebootRequired)) {
        useWriteFeedbackStore.getState().needReboot(reason)
      }
    })
  }

  const label = writeBusy ? 'Writing…' : dirtyCount > 0 ? `Write (${dirtyCount})` : 'Write'

  const modal = (
    <WriteParamsModal
      open={confirming}
      onConfirm={write}
      onCancel={() => setConfirming(false)}
      {...(owns ? { owns } : {})}
    />
  )

  return { dirtyCount, writeBusy, label, revert, confirm: () => setConfirming(true), modal }
}

/**
 * Revert, Write and -- when one is owed -- Reboot, on a card's title row.
 *
 * The buttons sit where the edits are made rather than at the bottom of the
 * window: the footer's Write is gone, and every Setup screen now writes from
 * its cards, its column, or as it is used. Ports had this first; it is shared
 * so the next screen cannot drift from it.
 */
export default function CardParamActions({
  reason,
  owns,
  onReverted,
}: {
  /** What the restart is owed for, shown as the prompt's question. */
  reason: string
  /** Which parameters this card is responsible for. */
  owns?: (param: string) => boolean
  /** Called after a revert, for a card with its own state to put back. */
  onReverted?: () => void
}) {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const w = useParamWrite({ reason, owns, onReverted })

  return (
    <>
      {w.modal}
      {/* Same shape as the compass card: nothing until a restart is owed,
          then "Reboot required" and the button, on the title row. */}
      <RebootPrompt inline />
      {/* Absent until there is something to do, rather than present and
          greyed. A disabled pair sat on every card on the screen at all times,
          which made the one card with staged edits no easier to find than the
          rest -- and a control that is never usable until you have already
          done the thing it acts on is not telling anyone anything. Kept up
          during the write itself, or "Writing…" would vanish the instant the
          last parameter stopped being dirty, which is exactly when it is
          reporting. A screen's column keeps its pair always present instead
          (`VehicleParamActions`), because it is the page's one place to write
          from and its buttons must not move. */}
      {(w.dirtyCount > 0 || w.writeBusy) && (
        <>
          <LaButton variant="ghost" disabled={w.writeBusy} onClick={w.revert}>
            Revert
          </LaButton>
          <LaButton variant="primary" disabled={w.writeBusy || !connected} onClick={w.confirm}>
            {w.label}
          </LaButton>
        </>
      )}
    </>
  )
}
