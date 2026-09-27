import { useRef, useState } from 'react'
import { LaButton, LaHint, LaSwitch } from '../../components/La'
import { useLogStore } from '../../../stores/log-store'
import { openLogFile } from '../../../services/log-file'
import { saveLogParams, saveOpenLog } from '../../../services/log-download'
import { webToolsFor } from '../../../protocol/log-tools'
import { openExternal } from '../../../env'
import VehicleLogs from './VehicleLogs'
import ExpressionInput from './ExpressionInput'
import PlotPresets from './PlotPresets'
import PlottedFields from './PlottedFields'
import LogPlot from './LogPlot'
import LogTable from './LogTable'
import LogReplay from './LogReplay'
import FieldPicker from './FieldPicker'
import Divider from '../../components/Divider'

// Reviewing a flight log.
//
//   ┌─────────┬────────────────────┬──────────┐
//   │ fields  │ plot, or the table │ open,    │
//   │ to plot ├────────────────────┤ download,│
//   │         │ 3D replay          │ view     │
//   └─────────┴────────────────────┴──────────┘
//
// Three columns, like the OSD screen: the field list (often hundreds of
// fields) on the left, the work in the middle, and the actions column on the
// right.
//
// A log opens into the 3D replay at full height. Plotting a field splits the
// middle column with the plot above; the table takes the same upper half.
//
// Logs are parsed in the page and never uploaded anywhere.

export default function LogsTab() {
  const log = useLogStore((s) => s.log)
  const status = useLogStore((s) => s.status)
  const upper = useLogStore((s) => s.upper)
  const setUpper = useLogStore((s) => s.setUpper)
  const shadeModes = useLogStore((s) => s.shadeModes)
  const split = useLogStore((s) => s.split)
  const setSplit = useLogStore((s) => s.setSplit)
  const mainRef = useRef<HTMLDivElement>(null)
  const setShadeModes = useLogStore((s) => s.setShadeModes)
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
      <div className={log ? 'log-body log-body--fields' : 'log-body'}>
        {/* Shown whenever a log is open, since picking a field is how the
            plot opens. */}
        {log && (
          <aside className="log-fields">
            <h3 className="app-col__head">Fields</h3>
            <FieldPicker />
            <ExpressionInput />
          </aside>
        )}

        <div className="log-main">
          {!log ? (
            <Welcome status={status} />
          ) : upper === 'none' ? (
            <LogReplay />
          ) : (
            <div
              className="log-split"
              ref={mainRef}
              style={
                {
                  '--split-top': `${split.toFixed(3)}fr`,
                  '--split-bottom': `${(1 - split).toFixed(3)}fr`,
                } as React.CSSProperties
              }
            >
              <div className="log-split__pane">{upper === 'plot' ? <LogPlot /> : <LogTable />}</div>
              <Divider
                orientation="horizontal"
                containerRef={mainRef}
                ratio={split}
                onRatio={setSplit}
              />
              <div className="log-split__pane">
                <LogReplay />
              </div>
            </div>
          )}
        </div>

        <aside className="app-col-shell">
          <div className="app-col">
            <section className="app-col__group">
              <h3 className="app-col__head">Log</h3>
              <LaButton variant="primary" size="block" disabled={busy} onClick={() => void open()}>
                Open log file
              </LaButton>
              {log && (
                <>
                  <p className="app-col__note">{describe(status)}</p>
                  {/* A download goes straight into the viewer, so this is how
                    a log pulled off the vehicle gets kept. */}
                  <LaButton
                    variant="secondary"
                    size="block"
                    onClick={() => bytes && saveOpenLog(describe(status) || 'log.bin', bytes)}
                    disabled={!bytes}
                  >
                    Save to file
                  </LaButton>
                  <LaButton
                    variant="secondary"
                    size="block"
                    disabled={!log.params.size}
                    title="Write the parameters recorded in this log to a .param file"
                    onClick={() => saveLogParams(describe(status) || 'log', log.params)}
                  >
                    Save parameters ({log.params.size})
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
                {/* Links to ArduPilot WebTools. There is no API to hand the
                  log over (the user drops the .bin in), so this says whether
                  the log has what each tool reads. */}
                <section className="app-col__group">
                  <h3 className="app-col__head">Analyze (WebTools)</h3>
                  {webToolsFor(log).map((t) => (
                    <LaButton
                      key={t.id}
                      variant="secondary"
                      size="block"
                      disabled={t.missing !== null}
                      title={t.missing ?? t.purpose}
                      onClick={() => openExternal(t.url)}
                    >
                      {t.name}
                    </LaButton>
                  ))}
                  <LaHint>
                    Opens in the browser — drop this log&rsquo;s .bin file into the page. If the log
                    came off the vehicle, Save to file first.
                  </LaHint>
                </section>

                <section className="app-col__group">
                  <h3 className="app-col__head">View</h3>
                  <div className="log-viewswitch" role="radiogroup" aria-label="Upper pane">
                    {(
                      [
                        ['none', '3D only'],
                        ['plot', 'Plot'],
                        ['table', 'Table'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={upper === id}
                        className={`log-viewswitch__btn${upper === id ? ' is-active' : ''}`}
                        onClick={() => setUpper(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {upper === 'plot' && (
                    <>
                      <LaSwitch
                        label="Shade by flight mode"
                        checked={shadeModes}
                        onChange={(e) => setShadeModes(e.target.checked)}
                      />
                      {/* Gestures are not discoverable by looking at a canvas. */}
                      <LaHint>
                        Drag across the plot to zoom to that stretch. Shift-drag pans, the wheel
                        zooms, a double-click puts it all back, and a click sends the replay there.
                      </LaHint>
                    </>
                  )}
                </section>

                <PlottedFields />
                <PlotPresets />
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

/**
 * The empty pane before a log is open: one line, plus progress while a file
 * is read. Open lives in the actions column only.
 */
function Welcome({ status }: { status: ReturnType<typeof useLogStore.getState>['status'] }) {
  return (
    <div className="log-welcome">
      {/* No heading: the rail already names the screen. */}
      <p className="app-placeholder">
        Open a dataflash <code>.bin</code> to plot and review a log.
      </p>
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
