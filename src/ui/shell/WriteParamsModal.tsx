import { useMemo } from 'react'
import { LaButton, LaModal } from '../components/La'
import { useParamStore } from '../../stores/param-store'

// What is about to be written, before it is written.
//
// Staged edits accumulate across tabs -- a frame change here, a failsafe
// there, forty rows taken from a file in the compare tool -- and Write Params
// is one button at the bottom of the window that sends all of it. Up to now
// the only record of what that button would do was a count.
//
// This is not a "are you sure": it is the list, because the useful question
// is never whether to write but whether *this* is what you meant to write.
// The moment that matters is a parameter you do not remember touching.

export interface WriteParamsModalProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Show only the edits this write will send.
   *
   * A card that owns its parameters sends only those, so listing the whole
   * staged set here would promise work the button is not going to do -- which
   * is exactly the misreading this dialog exists to prevent.
   */
  owns?: (param: string) => boolean
}

export default function WriteParamsModal({
  open,
  onConfirm,
  onCancel,
  owns,
}: WriteParamsModalProps) {
  const entries = useParamStore((s) => s.entries)
  const metadata = useParamStore((s) => s.metadata)

  const pending = useMemo(
    () =>
      [...entries.entries()]
        .filter(([name, e]) => e.dirty && (!owns || owns(name)))
        .map(([name, e]) => ({ name, from: e.origValue, to: e.value }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries, owns],
  )

  if (!open) return null

  return (
    <LaModal
      open
      wide
      title={`Write ${pending.length} parameter${pending.length === 1 ? '' : 's'}?`}
      actions={
        <>
          <LaButton variant="ghost" onClick={onCancel}>
            Cancel
          </LaButton>
          <LaButton variant="primary" onClick={onConfirm}>
            Write to vehicle
          </LaButton>
        </>
      }
    >
      <div className="param-compare__scroll">
        <table className="param-compare__table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col" className="mission-table__num">From</th>
              <th scope="col" className="mission-table__num">To</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.name} className="param-compare__row is-changed">
                <td>
                  <span className="param-compare__name la-selectable">{p.name}</span>
                  {metadata[p.name]?.displayName && (
                    <span className="param-compare__desc">{metadata[p.name]!.displayName}</span>
                  )}
                </td>
                <td className="mission-table__num">{p.from}</td>
                <td className="mission-table__num param-compare__new">{p.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LaModal>
  )
}
