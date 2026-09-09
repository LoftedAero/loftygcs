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
  const error = useParamStore((s) => s.error)
  const order = useParamStore((s) => s.order)
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

  if (phase !== 'connected' && phase !== 'linkLost') {
    return (
      <LaCard title="Parameters" note="Connect a vehicle to load its parameters.">
        <p className="app-placeholder">
          The full parameter table with search, official metadata, dirty-change highlighting, and
          file import/export.
        </p>
      </LaCard>
    )
  }

  if (loadState === 'downloading') {
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

  if (loadState === 'error') {
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
          {names.length} of {order.length} parameters. Changes stage here and are written from the
          column beside them.
          {/* Which documentation is on screen. Parameters are added and
                re-scaled between releases, so a hint from the wrong version
                is worse than no hint -- worth one line to say. */}
          {metadataSource && ` Hints from ArduPilot ${metadataSource}.`}
        </p>

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
