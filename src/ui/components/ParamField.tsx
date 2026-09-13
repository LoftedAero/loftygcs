import { LaSelect } from './La'
import { useParamStore } from '../../stores/param-store'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { connectionService } from '../../services/connection'

// One control bound to a parameter by name -- the building block of every
// curated view. Edits stage in the param store exactly like the Parameters
// tab, so the action bar's Write Params covers all of them and nothing
// reaches the vehicle on keystroke.
//
// `bare` drops the label wrapper for table layouts (Ports, Outputs), where
// the column heading is the label.
//
// `writeNow` is the exception to the staging rule above, and it is narrow on
// purpose: a parameter that *gates other parameters* leaves the screen
// showing nothing until it is written, so staging it means the page cannot
// show the work the page exists for. OSD_TYPE is the case -- with it at 0 the
// vehicle reports no panel positions, so the layout stays empty however many
// times you pick a backend. After the write it re-reads the parameter set in
// the background, which is where the newly exposed ones come from.
//
// It never writes on a keystroke. A dropdown writes on change, which is one
// deliberate choice; a number field writes on Enter or on leaving it, the
// same commit gesture the mission column's vehicle fields use. Typing "50"
// into a field that wrote every digit would send 5 on the way to 50.
export default function ParamField({
  param,
  label,
  unit,
  bare,
  writeNow,
  gatesOthers,
}: {
  param: string
  label: string
  unit?: string
  bare?: boolean
  writeNow?: boolean
  /**
   * Re-read the parameter set after writing this one.
   *
   * Only for a parameter that *exposes or hides other parameters* --
   * OSD_TYPE is the case, because at 0 the vehicle reports no panel
   * positions at all. It is separate from `writeNow` because the two are
   * different claims and bundling them was a real cost: every compass
   * setting on the Sensors screen writes immediately, and none of them
   * changes which parameters exist, so a refresh after each was ~1,400
   * parameters re-read to learn nothing. Over a telemetry radio that is
   * tens of seconds.
   */
  gatesOthers?: boolean
}) {
  const entry = useParamStore((s) => s.entries.get(param))
  const meta = useParamStore((s) => s.metadata[param])
  const edit = useParamStore((s) => s.edit)

  /**
   * Send it, then find out what the vehicle exposes now.
   *
   * A failed write falls back to staging rather than vanishing: the value
   * the user chose is still what they want, and the action bar's Write is
   * then the honest state of it.
   */
  const commit = (v: number) => {
    if (!writeNow) {
      edit(param, v)
      return
    }
    void connectionService
      .setParamNow(param, v)
      .then(() => {
        useWriteFeedbackStore.getState().report({ ok: true, param })
        // ArduPilot says which parameters it only reads at boot, so nothing
        // here needs a list of them: the metadata this field already has is
        // the authority.
        if (meta?.rebootRequired) {
          useWriteFeedbackStore.getState().needReboot(`${param} takes effect after a restart`)
        }
        if (!gatesOthers) return
        // Quiet on purpose: it skips `beginDownload`, so curated tabs are not
        // blanked to a loading card, and it merges rather than rebuilding, so
        // staged edits elsewhere survive. The app bar's blue bar still shows
        // it happening -- that reads off `progress`, which a quiet refresh
        // does set.
        return connectionService.refreshParams({ quiet: true })
      })
      .catch((err: unknown) => {
        // The value the user chose is still what they want, so it stays --
        // staged, which is the honest state of a write that did not land.
        edit(param, v)
        useWriteFeedbackStore.getState().report({
          ok: false,
          param,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }

  if (!entry) {
    if (bare) return <span className="la-muted">—</span>
    return (
      <div className="la-field">
        <label className="la-field__label">{label}</label>
        <span className="la-muted">not on this vehicle</span>
      </div>
    )
  }

  const control = meta?.values ? (
    <LaSelect
      value={String(entry.value)}
      onChange={(e) => commit(Number(e.target.value))}
      className={entry.dirty ? 'is-dirty' : ''}
      title={meta.description ?? param}
    >
      {Object.entries(meta.values).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
      {meta.values[entry.value] === undefined && (
        <option value={String(entry.value)}>{entry.value}</option>
      )}
    </LaSelect>
  ) : (
    <input
      className={entry.dirty ? 'la-input la-input--num is-dirty' : 'la-input la-input--num'}
      type="number"
      step={meta?.increment ?? 'any'}
      value={entry.value}
      title={meta?.description ?? param}
      onChange={(e) => {
        const v = Number(e.target.value)
        // Always stage on the way past, even for a `writeNow` field: the
        // control has to show what is being typed, and the commit below is
        // what sends it.
        if (Number.isFinite(v)) edit(param, v)
      }}
      onKeyDown={(e) => {
        if (writeNow && e.key === 'Enter') commit(Number(e.currentTarget.value))
      }}
      onBlur={(e) => {
        if (writeNow && Number(e.target.value) !== entry.origValue) {
          commit(Number(e.target.value))
        }
      }}
    />
  )

  if (bare) return control

  const unitText = unit ?? meta?.units
  return (
    <div className="la-field" title={meta?.description ?? param}>
      <label className="la-field__label">
        {label} {unitText && <span className="la-field__unit">{unitText}</span>}
      </label>
      {control}
    </div>
  )
}
