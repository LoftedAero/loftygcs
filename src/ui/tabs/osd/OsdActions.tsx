import { useRef, useState, type ReactNode } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import VehicleParamActions from '../../components/VehicleParamActions'
import ParamField from '../../components/ParamField'
import type { ParamFieldSpec } from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'
import { parseParamFile, sameValue } from '../../../protocol/param-file'

// The OSD page's actions column.
//
// Save and load cover only the OSD parameters (the OSD{n}_*_EN/X/Y triplets
// and OSD_* settings), since a screen layout transfers between aircraft where
// the rest of a configuration does not. The file is an ordinary .param file,
// so other tools can read it.

/** Everything the OSD owns: OSD_* settings and the per-screen OSDn_* items. */
export function isOsdParam(name: string): boolean {
  return /^OSD\d?_/.test(name)
}

/**
 * The OSD's actions column: vehicle actions and the layout file first, then
 * settings groups (`children`).
 */
export default function OsdActions({ children }: { children?: ReactNode }) {
  return (
    <div className="app-col-shell">
      <div className="app-col app-col--fields">
        {/* Scoped to OSD parameters, so edits staged on other screens are
            not sent from here. */}
        <VehicleParamActions
          title="OSD"
          owns={isOsdParam}
          reason="OSD changes take effect after a restart"
        />
        <section className="app-col__group">
          <h3 className="app-col__head">Layout file</h3>
          <SaveLayout />
          <LoadLayout />
        </section>
        {children}
      </div>
    </div>
  )
}

/**
 * A settings group in the column: ParamCard's field list as a column section.
 * Parameters the vehicle lacks are not drawn, and an empty group is hidden.
 * `children` are extra rows after the fields, such as a dialog button.
 */
export function OsdSettings({
  title,
  fields,
  children,
}: {
  title: string
  fields: ParamFieldSpec[]
  children?: ReactNode
}) {
  const entries = useParamStore((s) => s.entries)
  const present = fields.filter((f) => entries.has(f.param))
  if (present.length === 0 && !children) return null
  return (
    <section className="app-col__group">
      <h3 className="app-col__head">{title}</h3>
      {present.map((f) => (
        <ParamField
          key={f.param}
          param={f.param}
          label={f.label}
          {...(f.unit ? { unit: f.unit } : {})}
          {...(f.writeNow ? { writeNow: true } : {})}
          {...(f.gatesOthers ? { gatesOthers: true } : {})}
          {...(f.optionLabels ? { optionLabels: f.optionLabels } : {})}
          // The column is narrow: bitmasks show a count and values short
          // names, with the full text on hover.
          bitmaskCount
          shortOptions
        />
      ))}
      {children}
    </section>
  )
}

function SaveLayout() {
  const [note, setNote] = useState<string | null>(null)
  const save = () => {
    const { entries, order } = useParamStore.getState()
    const names = order.filter(isOsdParam)
    if (names.length === 0) {
      setNote('This vehicle has no OSD parameters to save.')
      return
    }
    const body = names.map((n) => `${n},${entries.get(n)?.value ?? 0}`).join('\n')
    const text = `# Loft GCS OSD layout — ${names.length} parameters\n${body}\n`
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'osd-layout.param'
    a.click()
    URL.revokeObjectURL(a.href)
    setNote(`Saved ${names.length} OSD parameters.`)
  }
  return (
    <>
      <LaButton variant="secondary" size="block" onClick={save}>
        Save layout to file
      </LaButton>
      {/* Always rendered so Load layout does not shift when a note appears. */}
      <LaHint>{note}</LaHint>
    </>
  )
}

/**
 * Load an OSD layout, staging only the OSD parameters it contains.
 *
 * A whole-vehicle .param file works too: everything outside the OSD is
 * ignored, so loading a layout never brings in someone else's tuning.
 */
function LoadLayout() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<{
    file: string
    staged: number
    ignoredNonOsd: number
    absent: number
  } | null>(null)

  const onFile = async (file: File) => {
    const { entries } = parseParamFile(await file.text())
    const { entries: current, edit } = useParamStore.getState()
    let staged = 0
    let ignoredNonOsd = 0
    let absent = 0
    for (const e of entries) {
      if (!isOsdParam(e.name)) {
        ignoredNonOsd++
        continue
      }
      const cur = current.get(e.name)
      if (!cur) {
        absent++
        continue
      }
      if (!sameValue(cur.value, e.value)) {
        edit(e.name, e.value)
        staged++
      }
    }
    setResult({ file: file.name, staged, ignoredNonOsd, absent })
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
        Load layout from file
      </LaButton>

      <LaModal
        open={result !== null}
        title="Layout loaded"
        actions={
          <LaButton variant="primary" onClick={() => setResult(null)}>
            Close
          </LaButton>
        }
      >
        <p className="app-placeholder">
          Staged {result?.staged ?? 0} OSD change{result?.staged === 1 ? '' : 's'} from{' '}
          {result?.file}. Nothing is written until you press Write.
        </p>
        {(result?.ignoredNonOsd ?? 0) > 0 && (
          <p className="app-placeholder">
            {result?.ignoredNonOsd} non-OSD parameter
            {result?.ignoredNonOsd === 1 ? ' was' : 's were'} ignored.
          </p>
        )}
        {/* Usually a different firmware version or panel set. */}
        {(result?.absent ?? 0) > 0 && (
          <LaHint>
            {result?.absent} OSD parameter{result?.absent === 1 ? '' : 's'} in the file
            {result?.absent === 1 ? ' is' : ' are'} not on this vehicle.
          </LaHint>
        )}
      </LaModal>
    </>
  )
}
