import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LaButton, LaCard, LaHint, LaInput } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import ParamSidebar from './ParamSidebar'
import { useConnectionStore } from '../../../stores/connection-store'
import ParamRow from './ParamRow'

// The full parameter table: the escape hatch that makes the curated
// Configuration tab safe to keep small. Virtualized -- a Copter has ~1400
// parameters and the DOM gets only the visible slice.
export default function ParamsTab() {
  const phase = useConnectionStore((s) => s.phase)
  const loadState = useParamStore((s) => s.loadState)
  const progress = useParamStore((s) => s.progress)
  const source = useParamStore((s) => s.source)
  const fileName = useParamStore((s) => s.fileName)
  const error = useParamStore((s) => s.error)
  const order = useParamStore((s) => s.order)
  const offline = phase !== 'connected' && phase !== 'linkLost'
  const metadataSource = useParamStore((s) => s.metadataSource)
  const [filter, setFilter] = useState('')

  const names = useMemo(() => {
    const f = filter.trim().toUpperCase()
    if (!f) return order
    return order.filter((n) => n.includes(f))
  }, [order, filter])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: names.length,
    getScrollElement: () => scrollRef.current,
    // Matches .param-row's min-height: the row carries a display name and
    // a description line under the value now.
    estimateSize: () => 52,
    overscan: 12,
  })

  // With nothing connected this screen still has a job: a saved parameter
  // file is a document, and reading, searching, comparing and editing one
  // needs no aircraft. Mission Planner has had exactly this for years and it
  // is the one page its disconnected Config screen keeps.
  //
  // The empty case is not special-cased at all. It renders the ordinary
  // screen with an empty table, and the column beside it already has the
  // control that fills it -- "Import all from file", which is the same
  // button whether it is opening a set or staging one against a vehicle. A
  // second opener that appeared only while disconnected would be one more
  // thing to keep in step with the first, for a state that is not special.
  if (!offline && loadState === 'downloading') {
    return (
      <LaCard title="Parameters">
        <p className="app-placeholder">
          Downloading parameters
          {progress
            ? ` via ${progress.source === 'ftp' ? 'MAVFTP' : 'message stream'}: ${
                progress.total > 0
                  ? `${Math.round((100 * progress.got) / progress.total)}%`
                  : `${progress.got} bytes`
              }`
            : '…'}
        </p>
      </LaCard>
    )
  }

  if (!offline && loadState === 'error') {
    return (
      <LaCard title="Parameters">
        <LaHint error>{error}</LaHint>
        <ReloadButton />
      </LaCard>
    )
  }

  return (
    // Not a card, and that is the point. Every other screen with an actions
    // column -- Logs, MAVFTP, Mission -- puts its main pane and its column
    // side by side on the page ground, each with its own frame. This one wrapped
    // both in a card, so a white bordered column sat 17px inside a white
    // bordered card and the two read as one panel with a divider through it.
    // MAVFTP already had the shape to copy: a card while there is nothing to
    // show, its own full-height layout once there is. The heading goes with
    // the card; the rail already says which screen this is.
    <div className="params-screen">
      {/* One grid, not a column beside a column: the toolbar and the note
          are placed in the table's track only, and the actions column is
          placed in the table's *row* -- so the two framed panels start and
          end on the same lines. Nested in a flex wrapper the column spanned
          all three rows and stood 58px taller than the table it sits beside,
          which reads as a misalignment rather than as a taller column. */}
      <div className="params-layout">
        {/* The search, the table and the count are one panel, so its frame
            runs the full height of the screen and matches the column's.
            They were three grid rows with the frame on the table alone,
            which left the table's box shorter than the column beside it at
            both ends. Header and footer do not scroll; only the rows do. */}
        <div className="params-pane">
          {/* Search stays with the list it filters. It wants the width, and
              it is the one control used while reading rather than between
              tasks -- which is what the actions column is for. */}
          <div className="la-row params-toolbar">
            <LaInput
              placeholder="Search parameters"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="la-grow"
            />
          </div>
          <div className="params-scroll" ref={scrollRef}>
            {/* The table's own empty state, inside the frame where the rows
                would be -- not a card standing in for the screen. It covers
                a filter that matched nothing as well as a set that has not
                been loaded, because both are the same news: there is
                nothing here to read. */}
            {names.length === 0 && (
              <p className="app-placeholder params-empty">
                {order.length === 0
                  ? 'Connect a vehicle or open a file to view parameters.'
                  : `Nothing matches “${filter}”.`}
              </p>
            )}
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={names[item.index]}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <ParamRow name={names[item.index]!} />
                </div>
              ))}
            </div>
          </div>
          <p className="params-note">
            {names.length} of {order.length} parameters
            {source === 'file' ? ` from ${fileName ?? 'a file'} — not a vehicle.` : '.'}
            {source === 'vehicle' &&
              ' Changes stage here and are written from the column beside them.'}
            {/* Which documentation is on screen. Parameters are added and
                re-scaled between releases, so a hint from the wrong version
                is worse than no hint -- worth one line to say. */}
            {metadataSource && ` Hints from ArduPilot ${metadataSource}.`}
          </p>
        </div>

        <aside className="app-col-shell">
          <ParamSidebar />
        </aside>
      </div>
    </div>
  )
}

function ReloadButton() {
  return (
    <LaButton
      variant="secondary"
      onClick={() => {
        // Lazy import dodges a ui -> services -> ui cycle at module load.
        void import('../../../services/connection').then(({ connectionService }) =>
          connectionService.refreshParams(),
        )
      }}
    >
      Retry download
    </LaButton>
  )
}
