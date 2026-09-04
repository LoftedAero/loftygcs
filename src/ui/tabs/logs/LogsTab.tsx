import { useState } from 'react'
import { LaButton, LaHint, LaSwitch } from '../../components/La'
import { useLogStore } from '../../../stores/log-store'
import { openLogFile } from '../../../services/log-file'
import { saveOpenLog } from '../../../services/log-download'
import VehicleLogs from './VehicleLogs'
import LogPlot from './LogPlot'
import LogTable from './LogTable'
import FieldPicker from './FieldPicker'

// Reviewing a flight log.
//
//   ┌─────────┬────────────────────┬──────────┐
//   │ fields  │ plot, or the       │ open,    │
//   │ to plot │ record table       │ download,│
//   │         │                    │ view     │
//   └─────────┴────────────────────┴──────────┘
//
// Three columns, the shape the OSD screen uses: the long list of things you
// can pick from on the left, the thing you are working on in the middle, and
// the actions column on the right where every other screen keeps it. The
// field list went left because it is a list to hunt through rather than a
// setting to adjust, and six hundred fields squeezed into the actions
// column left no room for the actions.
//
// Everything happens in the page: a log is never uploaded anywhere, which is
// worth saying out loud since the browser tools people currently use for
// this make a point of the same promise.

export default function LogsTab() {
  const log = useLogStore((s) => s.log)
  const status = useLogStore((s) => s.status)
  const view = useLogStore((s) => s.view)
  const setView = useLogStore((s) => s.setView)
  const axisMode = useLogStore((s) => s.axisMode)
  const setAxisMode = useLogStore((s) => s.setAxisMode)
  const shadeModes = useLogStore((s) => s.shadeModes)
  const setShadeModes = useLogStore((s) => s.setShadeModes)
  const selected = useLogStore((s) => s.selected)
  const clearFields = useLogStore((s) => s.clearFields)
  const clear = useLogStore((s) => s.clear)
  const bytes = useLogStore((s) => s.rawBytes)
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
      <div className={log && view === 'plot' ? 'log-body log-body--fields' : 'log-body'}>
        {log && view === 'plot' && (
          <aside className="log-fields">
            <h3 className="app-col__head">Fields</h3>
            <FieldPicker />
          </aside>
        )}

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
            {log && (
              <>
                <p className="app-col__note">{describe(status)}</p>
                {/* Saving is offered only once a log is open: a download
                    goes straight into the viewer, so this is how a log you
                    pulled off the vehicle gets kept. */}
                <LaButton
                  variant="secondary"
                  size="block"
                  onClick={() => bytes && saveOpenLog(describe(status) || 'log.bin', bytes)}
                  disabled={!bytes}
                >
                  Save to file
                </LaButton>
                <LaButton variant="ghost" size="block" onClick={clear}>
                  Close log
                </LaButton>
              </>
            )}
          </section>

          <VehicleLogs />

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
                    <div className="log-viewswitch" role="radiogroup" aria-label="Y axis">
                      {(
                        [
                          ['perField', 'Axis per field'],
                          ['shared', 'One shared axis'],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={axisMode === id}
                          className={`log-viewswitch__btn${axisMode === id ? ' is-active' : ''}`}
                          onClick={() => setAxisMode(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <LaHint>
                      An axis each keeps a metre and a microsecond both readable. Share one when
                      the traces are the same quantity — desired against actual.
                    </LaHint>
                    <LaSwitch
                      label="Shade by flight mode"
                      checked={shadeModes}
                      onChange={(e) => setShadeModes(e.target.checked)}
                    />
                    {selected.length > 0 && (
                      <LaButton variant="ghost" size="block" onClick={clearFields}>
                        Clear {selected.length} {selected.length === 1 ? 'field' : 'fields'}
                      </LaButton>
                    )}
                  </>
                )}
              </section>
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
