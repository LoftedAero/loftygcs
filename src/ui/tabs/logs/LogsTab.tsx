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
// Three columns, the shape the OSD screen uses: the long list of things you
// can pick from on the left, the thing you are working on in the middle, and
// the actions column on the right where every other screen keeps it. The
// field list went left because it is a list to hunt through rather than a
// setting to adjust, and six hundred fields squeezed into the actions
// column left no room for the actions.
//
// The replay owns the middle column and a log opens straight into it, full
// height: before you have asked for a number, a flight is a thing you
// watch. Plotting a field splits the space and puts the plot above it; the
// table takes that same upper half when you want records instead of curves.
// So the view follows what you asked for rather than being a mode to
// remember to switch.
//
// Everything happens in the page: a log is never uploaded anywhere, which is
// worth saying out loud since the browser tools people currently use for
// this make a point of the same promise.

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
        {/* Always beside an open log, whichever pane is up: picking a
            field is how the plot gets opened in the first place, so hiding
            the list until there is a plot leaves no way in. */}
        {log && (
          <aside className="log-fields">
            <h3 className="app-col__head">Fields</h3>
            <FieldPicker />
            <ExpressionInput />
          </aside>
        )}

        <div className="log-main">
          {!log ? (
            <Welcome status={status} busy={busy} onOpen={() => void open()} />
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
              {/* Link-outs to ArduPilot WebTools. There is no upload API to
                  hand the log across -- each opens in the browser and the
                  user drops the .bin in -- so the useful work here is saying
                  in advance whether this log has what each tool reads. */}
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
        Open a dataflash <code>.bin</code> to plot it and read its records. Parsing happens in this
        window — the log is not uploaded anywhere.
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
