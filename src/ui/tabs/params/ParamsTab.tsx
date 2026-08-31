import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LaButton, LaCard, LaHint, LaInput, LaModal } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import ParamCompareModal from './ParamCompareModal'
import {
  compareParams,
  parseParamFile,
  sameValue,
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
    <LaCard title="Parameters" className="params-card">
      <div className="la-row params-toolbar">
        <LaInput
          placeholder="Search parameters"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="la-grow"
        />
        <ImportButton />
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
 * Take the whole file, unreviewed — with a word of warning first.
 *
 * Compare exists because this is the risky one, so the warning is not
 * ceremony: it says what specifically goes wrong, which is that a parameter
 * set is not portable between airframes. Calibrations, radio trims, compass
 * offsets and PIDs all describe *this* aircraft, and a file from another one
 * overwrites them with numbers that were true somewhere else.
 */
function ImportButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [warning, setWarning] = useState(false)

  const onFile = async (file: File) => {
    const { entries, skipped } = parseParamFile(await file.text())
    const { entries: current, edit } = useParamStore.getState()
    let applied = 0
    for (const e of entries) {
      const cur = current.get(e.name)
      if (cur && !sameValue(cur.value, e.value)) {
        edit(e.name, e.value)
        applied++
      }
    }
    useParamStore.getState().setLastWrite(null)
    setImportResult({ file: file.name, applied, skipped: skipped.length, total: entries.length })
  }
  const [importResult, setImportResult] = useState<{
    file: string
    applied: number
    skipped: number
    total: number
  } | null>(null)

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
      <LaButton variant="ghost" onClick={() => setWarning(true)}>
        Import
      </LaButton>

      <LaModal
        open={warning}
        title="Import every parameter in the file?"
        actions={
          <>
            <LaButton variant="ghost" onClick={() => setWarning(false)}>
              Cancel
            </LaButton>
            <LaButton
              variant="secondary"
              onClick={() => {
                setWarning(false)
                fileRef.current?.click()
              }}
            >
              Choose a file
            </LaButton>
          </>
        }
      >
        <p className="app-placeholder">
          Import stages <strong>every</strong> difference between the file and this vehicle,
          without asking about any of them.
        </p>
        <p className="app-placeholder">
          A parameter set describes one particular aircraft. Accelerometer and compass
          calibration, radio trims and tuning gains were all measured on the machine the file
          came from — taking them wholesale onto a different airframe replaces good numbers with
          numbers that were true somewhere else.
        </p>
        <p className="app-placeholder">
          If the file came from another aircraft, use <strong>Compare</strong> instead and pick
          what you actually want.
        </p>
      </LaModal>

      <LaModal
        open={importResult !== null}
        title="Imported"
        actions={
          <LaButton variant="primary" onClick={() => setImportResult(null)}>
            Close
          </LaButton>
        }
      >
        <p className="app-placeholder">
          Staged {importResult?.applied ?? 0} change
          {importResult?.applied === 1 ? '' : 's'} from {importResult?.file} — nothing has been
          written yet. Review them with Write Params, or Revert to drop them.
        </p>
        {(importResult?.skipped ?? 0) > 0 && (
          <LaHint error>
            {importResult?.skipped} line{importResult?.skipped === 1 ? '' : 's'} could not be
            read.
          </LaHint>
        )}
      </LaModal>
    </>
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
