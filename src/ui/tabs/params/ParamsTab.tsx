import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LaButton, LaCard, LaHint, LaInput } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import ParamSidebar from './ParamSidebar'
import { useConnectionStore } from '../../../stores/connection-store'
import ParamRow from './ParamRow'

// The full parameter table, behind the curated setup screens. Virtualized:
// a Copter has about 1400 parameters and only the visible slice is rendered.
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
    // Matches .param-row's min-height (name plus a description line).
    estimateSize: () => 52,
    overscan: 12,
  })

  // With nothing connected this screen still opens and edits a saved
  // parameter file, as Mission Planner does. The empty case is the ordinary
  // screen with an empty table; "Import from file" in the column fills it.
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
    // Not a card: like the other screens with an actions column, the pane and
    // the column sit side by side, each with its own frame.
    <div className="params-screen">
      {/* One grid, so the pane and the actions column start and end on the
          same lines. */}
      <div className="params-layout">
        {/* Search, table and count are one framed panel; only the rows
            scroll. */}
        <div className="params-pane">
          {/* Search stays with the list it filters. */}
          <div className="la-row params-toolbar">
            <LaInput
              placeholder="Search parameters"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="la-grow"
            />
          </div>
          <div className="params-scroll" ref={scrollRef}>
            {/* Empty state for both an unloaded set and a filter with no
                matches. */}
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
            {/* Which release the documentation is from, since parameters
                change between releases. */}
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
