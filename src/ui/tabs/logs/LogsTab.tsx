import { useState } from 'react'
import { LaButton, LaHint, LaSwitch } from '../../components/La'
import { useLogStore } from '../../../stores/log-store'
import { openLogFile } from '../../../services/log-file'
import LogPlot from './LogPlot'
import LogTable from './LogTable'
import FieldPicker from './FieldPicker'

// Reviewing a flight log.
//
//   ┌──────────────────────────────┬──────────┐
//   │ plot, or the record table    │ open,    │
//   │                              │ view,    │
//   │                              │ fields   │
//   └──────────────────────────────┴──────────┘
//
// The actions column on the right like every other editing screen, holding
// where the log came from, which view is showing, and -- taking most of it --
// the field picker, because choosing what to look at is the whole activity.
//
// Everything happens in the page: a log is never uploaded anywhere, which is
// worth saying out loud since the browser tools people currently use for
// this make a point of the same promise.

export default function LogsTab() {
  const log = useLogStore((s) => s.log)
  const status = useLogStore((s) => s.status)
  const view = useLogStore((s) => s.view)
  const setView = useLogStore((s) => s.setView)
  const normalize = useLogStore((s) => s.normalize)
  const setNormalize = useLogStore((s) => s.setNormalize)
  const selected = useLogStore((s) => s.selected)
  const clearFields = useLogStore((s) => s.clearFields)
  const clear = useLogStore((s) => s.clear)
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      await openLogFile()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="log-screen">
      <div className="log-body">
        <div className="log-main">
          {!log ? (
            <Welcome status={status} busy={busy} onOpen={() => void open()} />
          ) : view === 'plot' ? (
            <LogPlot />
          ) : (
            <LogTable />
          )}
        </div>

        <aside className="app-col log-side">
          <section className="app-col__group">
            <h3 className="app-col__head">Log</h3>
            <LaButton variant="primary" size="block" disabled={busy} onClick={() => void open()}>
              Open log file
            </LaButton>
            {/* Downloading off the vehicle is the obvious next thing and is
                not built yet; saying so beats a button that does nothing. */}
            <LaButton variant="secondary" size="block" disabled title="Not built yet">
              Download from vehicle
            </LaButton>
            <LaHint>Reading a log off the vehicle over MAVFTP is not wired up yet.</LaHint>
            {log && (
              <>
                <p className="app-col__note">{describe(status)}</p>
                <LaButton variant="ghost" size="block" onClick={clear}>
                  Close log
                </LaButton>
              </>
            )}
          </section>

          {log && (
            <>
              <section className="app-col__group">
                <h3 className="app-col__head">View</h3>
                <div className="log-viewswitch" role="tablist" aria-label="View">
                  {(['plot', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={view === v}
                      className={`log-viewswitch__btn${view === v ? ' is-active' : ''}`}
                      onClick={() => setView(v)}
                    >
                      {v === 'plot' ? 'Plot' : 'Data table'}
                    </button>
                  ))}
                </div>
                {view === 'plot' && (
                  <>
                    <LaSwitch
                      label="Normalize each field"
                      checked={normalize}
                      onChange={(e) => setNormalize(e.target.checked)}
                    />
                    <LaHint>
                      Puts every trace on its own 0–1 scale, for comparing the shape of things
                      measured in different units.
                    </LaHint>
                    {selected.length > 0 && (
                      <LaButton variant="ghost" size="block" onClick={clearFields}>
                        Clear {selected.length} {selected.length === 1 ? 'field' : 'fields'}
                      </LaButton>
                    )}
                  </>
                )}
              </section>

              {view === 'plot' && (
                <section className="app-col__group app-col__group--grow">
                  <h3 className="app-col__head">Fields</h3>
                  <FieldPicker />
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function Welcome({
  status,
  busy,
  onOpen,
}: {
  status: ReturnType<typeof useLogStore.getState>['status']
  busy: boolean
  onOpen: () => void
}) {
  return (
    <div className="log-welcome">
      <h2 className="log-welcome__title">Flight logs</h2>
      <p className="app-placeholder">
        Open a dataflash <code>.bin</code> to plot it and read its records. Parsing happens in
        this window — the log is not uploaded anywhere.
      </p>
      <p className="app-placeholder">
        RC and servo channels are named by what they do on the aircraft that flew, read from the
        parameters stored inside the log itself.
      </p>
      <div className="la-row">
        <LaButton variant="primary" disabled={busy} onClick={onOpen}>
          Open log file
        </LaButton>
      </div>
      {status.kind === 'reading' && (
        <LaHint>
          Reading {status.name} — {Math.round((status.got / Math.max(1, status.total)) * 100)}%
        </LaHint>
      )}
      {status.kind === 'parsing' && <LaHint>Parsing {status.name}…</LaHint>}
      {status.kind === 'error' && <LaHint error>{status.text}</LaHint>}
    </div>
  )
}

function describe(status: ReturnType<typeof useLogStore.getState>['status']): string {
  return status.kind === 'ready' ? status.name : ''
}
