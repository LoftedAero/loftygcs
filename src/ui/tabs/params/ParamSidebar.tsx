import { useRef, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import { useParamStore } from '../../../stores/param-store'
import VehicleParamActions from '../../components/VehicleParamActions'
import ParamCompareModal from './ParamCompareModal'
import {
  compareParams,
  parseParamFile,
  sameValue,
  type CompareRow,
} from '../../../protocol/param-file'

// The Parameters page's actions column: vehicle actions, then file actions.
// Staged edits belong to the page (leaving with unwritten edits prompts), so
// the page carries its own Write.

export default function ParamSidebar() {
  return (
    <div className="app-col">
      <VehicleParamActions />

      <section className="app-col__group">
        <h3 className="app-col__head">File</h3>
        <CompareButton />
        <ImportButton />
        <ExportButton />
      </section>
    </div>
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
    <LaButton variant="secondary" size="block" onClick={download}>
      Save to file
    </LaButton>
  )
}

/**
 * Load a file and show what it would change. Listed above Import, which
 * stages every difference unreviewed.
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
      <LaButton variant="secondary" size="block" onClick={() => fileRef.current?.click()}>
        Compare with file
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

/**
 * Take the whole file, unreviewed, after a warning that calibrations and
 * hardware-specific values belong to the aircraft they were measured on.
 */
function ImportButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [warning, setWarning] = useState(false)
  const [result, setResult] = useState<{
    file: string
    applied: number
    /** True when the file *became* the set rather than staging against one. */
    opened: boolean
    skipped: number
  } | null>(null)

  const onFile = async (file: File) => {
    const { entries, skipped } = parseParamFile(await file.text())
    const { entries: current, edit, loadedFile } = useParamStore.getState()

    // Nothing loaded: open the file as the parameter set. It is marked as a
    // file, so nothing offers to write it to an aircraft.
    if (current.size === 0) {
      loadedFile(
        // A file has no MAVLink types; assume REAL32, as Mission Planner does.
        // It only matters for a set that can be written, which a file cannot.
        entries.map((e) => ({ name: e.name, value: e.value, mavType: 9 })),
        file.name,
      )
      setResult({ file: file.name, applied: entries.length, opened: true, skipped: skipped.length })
      return
    }

    let applied = 0
    for (const e of entries) {
      const cur = current.get(e.name)
      if (cur && !sameValue(cur.value, e.value)) {
        edit(e.name, e.value)
        applied++
      }
    }
    setResult({ file: file.name, applied, opened: false, skipped: skipped.length })
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
      <LaButton
        variant="ghost"
        size="block"
        onClick={() => {
          // With nothing loaded there is nothing to overwrite, so no warning.
          if (useParamStore.getState().entries.size === 0) fileRef.current?.click()
          else setWarning(true)
        }}
      >
        Import from file
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
              Continue
            </LaButton>
          </>
        }
      >
        {/* The risk, and the safer alternative. */}
        <p className="app-placeholder">
          This may overwrite calibrations and hardware-specific values. Only perform this action if
          you know it is safe for this parameter set.
        </p>
        <p className="app-placeholder">
          Use <strong>Compare with file</strong> to perform a selective import.
        </p>
      </LaModal>

      <LaModal
        open={result !== null}
        title={result?.opened ? 'Opened' : 'Imported'}
        actions={
          <LaButton variant="primary" onClick={() => setResult(null)}>
            Close
          </LaButton>
        }
      >
        <p className="app-placeholder">
          {result?.opened ? (
            `Opened ${result.applied} parameter${result.applied === 1 ? '' : 's'} from ${result.file}. These are the file's, not a vehicle's.`
          ) : (
            /* Names the column's buttons as labeled there. */
            <>
              Staged {result?.applied ?? 0} change{result?.applied === 1 ? '' : 's'} from{' '}
              {result?.file} - review and choose <strong>Write</strong> or <strong>Revert</strong>
            </>
          )}
        </p>
        {(result?.skipped ?? 0) > 0 && (
          <LaHint error>
            {result?.skipped} line{result?.skipped === 1 ? '' : 's'} could not be read.
          </LaHint>
        )}
      </LaModal>
    </>
  )
}
