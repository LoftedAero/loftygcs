import { useRef, useState, type ReactNode } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import VehicleParamActions from '../../components/VehicleParamActions'
import ParamField from '../../components/ParamField'
import type { ParamFieldSpec } from '../../components/ParamCard'
import { useParamStore } from '../../../stores/param-store'
import { parseParamFile, sameValue } from '../../../protocol/param-file'

// The OSD page's actions column.
//
// Save and load are limited to the OSD parameters, which is the useful unit:
// a screen layout is a hundred-odd OSD{n}_*_EN/X/Y triplets plus a handful of
// OSD_* settings, and it is the one part of a configuration that genuinely
// does transfer between aircraft -- where you like the battery voltage on
// screen has nothing to do with which airframe is underneath it.
//
// Mission Planner does not have this. Its OSD screen offers Copy Layout and
// Paste Layout, which move one screen to another through the clipboard within
// a session, and its file handling is the generic whole-parameter save. A
// filtered .param file is the same idea that survives closing the app, and it
// stays in the format every other tool in the ecosystem reads.

/** Everything the OSD owns: OSD_* settings and the per-screen OSDn_* items. */
export function isOsdParam(name: string): boolean {
  return /^OSD\d?_/.test(name)
}

/**
 * The OSD's one column: what you do first -- vehicle actions, the layout file
 * -- and what you set after, as groups of the same tile (`children`), the
 * order every screen's column keeps.
 */
export default function OsdActions({ children }: { children?: ReactNode }) {
  return (
    <div className="app-col-shell">
      <div className="app-col app-col--fields">
        {/* Scoped to the OSD's own parameters, as a card's Write is to its
            card's: an edit staged on another screen is not this page's to
            send. */}
        <VehicleParamActions
          title="OSD"
          owns={isOsdParam}
          reason="OSD changes take effect after a restart"
        />
        <section className="app-col__group">
          <h3 className="app-col__head">Layout file</h3>
          {/* That these touch only the OSD parameters is what the buttons
              say by being in a group called Layout file, and is the whole
              subject of this file's header comment. */}
          <SaveLayout />
          <LoadLayout />
        </section>
        {children}
      </div>
    </div>
  )
}

/**
 * A settings group in the column: ParamCard's field list, as a section of the
 * column rather than a card of its own. The same presence rule -- a parameter
 * the vehicle does not report is not drawn, and a group with none is not
 * either. `children` are rows of the group's own after the fields, such as a
 * button opening a dialog; they are drawn only with the group.
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
          // Too narrow here for a bitmask's names or ArduPilot's longer value
          // names: "2 selected", short names, the full text on hover.
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
      {/* Always drawn: the result sits between the two buttons, and mounting
          it on demand pushed Load layout down the column. */}
      <LaHint>{note}</LaHint>
    </>
  )
}

/**
 * Load an OSD layout, staging only the OSD parameters it contains.
 *
 * A whole-vehicle .param file works here too and is a normal thing to hand
 * it: everything outside the OSD is ignored rather than applied, which is
 * the difference between borrowing somebody's screen layout and inheriting
 * their tuning.
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
        {/* Usually a different firmware version or panel set -- which is not
            something the reader can act on here. */}
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
