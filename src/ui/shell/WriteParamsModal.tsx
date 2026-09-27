import { useMemo } from 'react'
import { LaButton, LaModal } from '../components/La'
import { useParamStore } from '../../stores/param-store'

// Lists what a write is about to send. Staged edits accumulate across tabs,
// so the confirmation shows each parameter with its old and new value rather
// than just asking whether to write.

export interface WriteParamsModalProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  /**
   * Limits the list to the edits this write will send, for a card that
   * writes only its own parameters.
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
              <th scope="col" className="mission-table__num">
                From
              </th>
              <th scope="col" className="mission-table__num">
                To
              </th>
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
