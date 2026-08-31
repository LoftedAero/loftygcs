import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LaButton, LaCard, LaHint, LaInput } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import ParamCompareModal from './ParamCompareModal'
import {
  compareParams,
  parseParamFile,
  type CompareRow,
} from '../../../protocol/param-file'
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
  const lastWrite = useParamStore((s) => s.lastWrite)
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
    estimateSize: () => 36,
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
    <LaCard title="Parameters" className="params-card">
      <div className="la-row params-toolbar">
        <LaInput
          placeholder="Search parameters"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="la-grow"
        />
        <ExportButton />
        <CompareButton />
      </div>
      {lastWrite && (
        <LaHint error={lastWrite.failed.length > 0}>
          {lastWrite.failed.length > 0
            ? `Wrote ${lastWrite.written}; failed: ${lastWrite.failed.join(', ')}`
            : `Wrote ${lastWrite.written} parameter${lastWrite.written === 1 ? '' : 's'}.`}
        </LaHint>
      )}
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
      <p className="la-card__note">
        {names.length} of {order.length} parameters. Changes stage here and are sent with Write
        Params below.
      </p>
    </LaCard>
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

function ExportButton() {
  const download = () => {
    const { entries, order } = useParamStore.getState()
    const lines = order.map((n) => `${n},${entries.get(n)?.value ?? 0}`)
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'loftgcs.param'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <LaButton variant="ghost" onClick={download}>
      Export
    </LaButton>
  )
}

/**
 * Load a file and show what it would change, rather than changing it.
 *
 * This replaced a plain Import that applied every difference the moment the
 * file was chosen. That is safe only when the file came off this aircraft;
 * from a similar one it quietly rewrites the parts that differ *because the
 * aircraft differ*, and nothing on screen distinguishes those from the edits
 * that were wanted.
 */
function CompareButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{
    name: string
    rows: CompareRow[]
    skipped: { line: number; text: string }[]
  } | null>(null)

  const onFile = async (file: File) => {
    const { entries, skipped } = parseParamFile(await file.text())
    setState({
      name: file.name,
      rows: compareParams(entries, useParamStore.getState().entries),
      skipped,
    })
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".param,.parm,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />
      <LaButton variant="ghost" onClick={() => fileRef.current?.click()}>
        Compare…
      </LaButton>
      <ParamCompareModal
        open={state !== null}
        fileName={state?.name ?? ''}
        rows={state?.rows ?? []}
        skipped={state?.skipped ?? []}
        onClose={() => setState(null)}
      />
    </>
  )
}
