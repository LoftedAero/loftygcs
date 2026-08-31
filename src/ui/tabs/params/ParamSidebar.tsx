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

// The Parameters page's own actions column, matching the Mission planner's.
//
// These used to be split: Write, Revert and Refresh in the global action bar,
// the file actions in a strip above the table. That split made sense while
// staged edits could cross pages -- the footer button was the one place that
// could send all of them. Now that leaving a page with unwritten edits asks
// first, the edits belong to the page, and so do the buttons.
//
// The footer still carries Write for every other Setup tab; this column
// replaces it only here.

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
 * Load a file and show what it would change, rather than changing it.
 *
 * Listed above Import because it is the one to reach for: Import applies
 * every difference sight unseen, which is only safe when the file came off
 * this same aircraft.
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
        Compare with file…
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
 * Take the whole file, unreviewed — with a word of warning first.
 *
 * The warning says what specifically goes wrong rather than asking whether
 * you are sure: a parameter set describes one aircraft, and its calibrations,
 * trims and gains were measured on that machine.
 */
function ImportButton() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [warning, setWarning] = useState(false)
  const [result, setResult] = useState<{ file: string; applied: number; skipped: number } | null>(
    null,
  )

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
    setResult({ file: file.name, applied, skipped: skipped.length })
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
      <LaButton variant="ghost" size="block" onClick={() => setWarning(true)}>
        Import all from file
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
          If the file came from another aircraft, use <strong>Compare with file</strong> instead
          and pick what you actually want.
        </p>
      </LaModal>

      <LaModal
        open={result !== null}
        title="Imported"
        actions={
          <LaButton variant="primary" onClick={() => setResult(null)}>
            Close
          </LaButton>
        }
      >
        <p className="app-placeholder">
          Staged {result?.applied ?? 0} change{result?.applied === 1 ? '' : 's'} from{' '}
          {result?.file} — nothing has been written yet. Review them with Write params, or Revert
          to drop them.
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
