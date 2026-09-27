import { useState } from 'react'
import { LaButton } from './La'
import RebootPrompt from './RebootPrompt'
import WriteParamsModal from '../shell/WriteParamsModal'
import { useParamStore } from '../../stores/param-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { connectionService } from '../../services/connection'

/**
 * Reverting and writing staged parameters: the behavior behind every Write
 * button, shared by card title rows and screen columns (`VehicleParamActions`)
 * so they count, confirm and prompt for a reboot the same way.
 *
 * `owns` scopes the count, revert and write to one card's parameters, so a
 * card's Write never sends another card's edits. Without it, everything
 * staged is included.
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
  // Select a count rather than the map, so the row re-renders only when the
  // count changes.
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
      // ArduPilot's metadata says which parameters are read only at boot
      // (a frame class, not a filter frequency).
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

/** Revert, Write and, when needed, Reboot, on a card's title row. */
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
      {/* Nothing until a restart is needed, then "Reboot required" and the
          button. */}
      <RebootPrompt inline />
      {/* Hidden rather than disabled until there are edits, so the card with
          staged edits stands out. Kept during the write so "Writing…" stays
          visible. A screen's column (`VehicleParamActions`) always shows its
          pair instead, so its buttons do not move. */}
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
