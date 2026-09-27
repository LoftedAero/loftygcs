import { useMemo, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../components/La'
import { useParamStore } from '../../stores/param-store'
import { useUiStore } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'
import { connectionService } from '../../services/connection'
import { MODES, TABS } from '../../stores/ui-store'

// Leaving a page with parameter edits that were never sent. Lists the edits
// rather than counting them, since the one that matters is the one the user
// forgot making. Offers write, discard or stay.

export default function UnsavedChangesModal() {
  const pending = useUiStore((s) => s.pendingNav)
  const commit = useUiStore((s) => s.commitPendingNav)
  const cancel = useUiStore((s) => s.cancelPendingNav)
  const entries = useParamStore((s) => s.entries)
  const revertAll = useParamStore((s) => s.revertAll)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const [writing, setWriting] = useState(false)

  const changes = useMemo(
    () =>
      [...entries.entries()]
        .filter(([, e]) => e.dirty)
        .map(([name, e]) => ({ name, from: e.origValue, to: e.value }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  )

  if (!pending) return null

  const target = pending.tab
    ? (TABS.find((t) => t.id === pending.tab)?.label ?? 'another page')
    : (MODES.find((m) => m.id === pending.mode)?.label ?? 'another page')

  const writeThenGo = async () => {
    setWriting(true)
    try {
      const result = await connectionService.writeDirtyParams()
      useParamStore.getState().setLastWrite(result)
      // A failed write stays on the page that can explain the failure.
      if (result.failed.length === 0) commit()
      else cancel()
    } finally {
      setWriting(false)
    }
  }

  return (
    <LaModal
      open
      wide
      title={`${changes.length} unwritten change${changes.length === 1 ? '' : 's'}`}
      actions={
        <>
          <LaButton variant="ghost" disabled={writing} onClick={cancel}>
            Stay here
          </LaButton>
          <LaButton
            variant="secondary"
            disabled={writing}
            onClick={() => {
              revertAll()
              commit()
            }}
          >
            Discard and leave
          </LaButton>
          <LaButton
            variant="primary"
            disabled={writing || !connected}
            onClick={() => void writeThenGo()}
          >
            {writing ? 'Writing…' : 'Write and continue'}
          </LaButton>
        </>
      }
    >
      <p className="app-placeholder">
        These have not been sent to the vehicle. Leaving for <strong>{target}</strong> keeps them
        staged, but nothing here will remind you they exist.
      </p>

      {/* Marks this dialog for the equal-width action row in app.css. */}
      <div className="param-compare__scroll leave-prompt">
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
            {changes.map((c) => (
              <tr key={c.name} className="param-compare__row is-changed">
                <td>
                  <span className="param-compare__name la-selectable">{c.name}</span>
                </td>
                <td className="mission-table__num">{c.from}</td>
                <td className="mission-table__num param-compare__new">{c.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!connected && (
        <LaHint error>
          No vehicle connected, so these cannot be written — discard them or reconnect.
        </LaHint>
      )}
    </LaModal>
  )
}
