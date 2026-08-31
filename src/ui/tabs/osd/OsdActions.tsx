import { useRef, useState } from 'react'
import { LaButton, LaHint, LaModal } from '../../components/La'
import VehicleParamActions from '../../components/VehicleParamActions'
import { useParamStore } from '../../../stores/param-store'
import { parseParamFile, sameValue } from '../../../protocol/param-file'
import { TYPE_MSP_DISPLAYPORT } from './osd-layout'

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

export default function OsdActions() {
  return (
    <div className="app-col osd-actions">
      <VehicleParamActions title="OSD" />
      <section className="app-col__group">
        <h3 className="app-col__head">Layout file</h3>
        <SaveLayout />
        <LoadLayout />
        <LaHint>Only the OSD parameters — the rest of the vehicle is untouched.</LaHint>
      </section>
    </div>
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
      {note && <LaHint>{note}</LaHint>}
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
          {result?.file}. Nothing is written until you press Write params.
        </p>
        {(result?.ignoredNonOsd ?? 0) > 0 && (
          <p className="app-placeholder">
            {result?.ignoredNonOsd} non-OSD parameter
            {result?.ignoredNonOsd === 1 ? ' was' : 's were'} ignored — this loads screen layout
            only.
          </p>
        )}
        {(result?.absent ?? 0) > 0 && (
          <LaHint>
            {result?.absent} OSD parameter{result?.absent === 1 ? '' : 's'} in the file
            {result?.absent === 1 ? ' is' : ' are'} not on this vehicle, usually a different
            firmware version or panel set.
          </LaHint>
        )}
      </LaModal>
    </>
  )
}

/** The backends worth offering by name; the rest stay in the Display card. */
const BACKENDS = [
  { value: 1, label: 'Analog (MAX7456)', note: 'The onboard chip most boards have.' },
  { value: 5, label: 'MSP DisplayPort', note: 'Digital HD systems — Walksnail, HDZero, DJI.' },
] as const

/**
 * Turning the OSD on, from the page that lays it out.
 *
 * With OSD_TYPE at 0 nothing is drawn on the video, and the only way to
 * change that was the Display card's numeric field or a trip to the
 * Parameters table — both of which need you to already know that 1 is a
 * MAX7456 and 5 is DisplayPort.
 */
export function OsdTypePrompt() {
  const entries = useParamStore((s) => s.entries)
  const edit = useParamStore((s) => s.edit)
  const type = entries.get('OSD_TYPE')
  if (!type || type.value !== 0) return null

  return (
    <section className="app-col__group osd-actions__off">
      <h3 className="app-col__head">The OSD is off</h3>
      <p className="app-placeholder">
        Nothing is drawn on the video feed. Screens can still be laid out, and take effect once a
        type is set.
      </p>
      {BACKENDS.map((b) => (
        <LaButton
          key={b.value}
          variant={b.value === TYPE_MSP_DISPLAYPORT ? 'secondary' : 'primary'}
          size="block"
          title={b.note}
          onClick={() => edit('OSD_TYPE', b.value)}
        >
          {b.label}
        </LaButton>
      ))}
      <LaHint>Staged like any parameter, and the vehicle needs a reboot to apply it.</LaHint>
    </section>
  )
}
