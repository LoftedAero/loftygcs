import { useState } from 'react'
import { LaButton } from './La'
import RebootPrompt from './RebootPrompt'
import WriteParamsModal from '../shell/WriteParamsModal'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { connectionService } from '../../services/connection'

/**
 * Revert, Write and -- when one is owed -- Reboot, on a card's title row.
 *
 * A screen that carries its own Write suppresses the global footer's copy
 * (`OWN_WRITE_TABS` in the action bar), so the buttons sit where the edits are
 * made rather than at the bottom of the window. Ports had this first; it is
 * shared so the next screen cannot drift from it.
 *
 * **A card owns its parameters.** `owns` scopes the count, the revert and the
 * write to them, because a screen can hold two cards that both edit
 * parameters, and a button labelled "Write (14)" on one of them must not
 * quietly send the other's edits -- nor count them. Without a scope the
 * buttons mean what the footer means: everything staged, anywhere.
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
  const connected = useConnectionStore((s) => s.phase === 'connected')
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

  return (
    <>
      <WriteParamsModal
        open={confirming}
        onConfirm={write}
        onCancel={() => setConfirming(false)}
        {...(owns ? { owns } : {})}
      />
      {/* Same shape as the compass card: nothing until a restart is owed,
          then "Reboot required" and the button, on the title row. */}
      <RebootPrompt />
      {/* Absent until there is something to do, rather than present and
          greyed. A disabled pair sat on every card on the screen at all times,
          which made the one card with staged edits no easier to find than the
          rest -- and a control that is never usable until you have already
          done the thing it acts on is not telling anyone anything. Kept up
          during the write itself, or "Writing…" would vanish the instant the
          last parameter stopped being dirty, which is exactly when it is
          reporting. */}
      {(dirtyCount > 0 || writeBusy) && (
        <>
          <LaButton variant="ghost" disabled={writeBusy} onClick={revert}>
            Revert
          </LaButton>
          <LaButton
            variant="primary"
            disabled={writeBusy || !connected}
            onClick={() => setConfirming(true)}
          >
            {writeBusy ? 'Writing…' : `Write (${dirtyCount})`}
          </LaButton>
        </>
      )}
    </>
  )
}
