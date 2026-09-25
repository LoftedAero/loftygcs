import { useRef, useState } from 'react'
import { LaButton, LaSelect } from './La'
import BitmaskEditor, { describeBits } from './BitmaskEditor'
import WriteFeedback from './WriteFeedback'
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
  stacked,
  showName,
  disabled,
  numeric,
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
  /** Label above the control rather than beside it, as `LaField`'s `stacked`. */
  stacked?: boolean
  /**
   * Print the ArduPilot name under the label.
   *
   * A curated field is named for what it does, which is the point of curating
   * it -- but the name is what the wiki, the forums and the Parameters tab all
   * call the same setting, and without it a reader cannot carry an answer from
   * one to the other. Off by default: a screen whose every row carries a
   * SHOUTING_IDENTIFIER is the parameter table with extra steps, so it is the
   * setup screens that opt in.
   */
  showName?: boolean
  /**
   * Editable, but not yet meaningful.
   *
   * For a field whose value only means something once another one is on --
   * the airspeed sensor's type under its enable. Greyed rather than hidden,
   * because a row that disappears takes the reader's place on the card with
   * it, and what is being said is "this is here, and it is not in play yet".
   */
  disabled?: boolean
  /**
   * Edit it as a number even though ArduPilot names some of its values.
   *
   * `@Values` on a *continuous* parameter is a list of suggestions, not an
   * enumeration: MOT_SPIN_MIN names 0.0, 0.15 and 0.25 over a range of 0 to
   * 0.25 with an increment of 0.01. Rendered as a dropdown it can neither
   * show what the vehicle is set to -- a bench-tuned 0.12 becomes a lone
   * unnamed entry, and the stock 0.15 reads as the word "Default" -- nor let
   * anyone type the value between two of them.
   *
   * Declared per field rather than inferred from "has both Values and Range",
   * which 185 Copter parameters do: BATT_VOLT_PIN is one of them, and its
   * values are hardware names that belong in a list.
   */
  numeric?: boolean
}) {
  const entry = useParamStore((s) => s.entries.get(param))
  const meta = useParamStore((s) => s.metadata[param])
  const edit = useParamStore((s) => s.edit)
  const [bitmaskOpen, setBitmaskOpen] = useState(false)
  // The commit, reachable from a native listener that outlives this render.
  const commitRef = useRef<(v: number) => void>(() => {})

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

  commitRef.current = commit

  if (!entry) {
    if (bare) {
      // A table row's control, greyed rather than dashed when the row is one a
      // card always draws: the same empty dropdown a named field shows below.
      return disabled ? (
        <LaSelect disabled value="">
          <option value="">—</option>
        </LaSelect>
      ) : (
        <span className="la-muted">—</span>
      )
    }
    // Deliberately out of play *and* not yet reported: the quadplane frame
    // fields, which the firmware only creates once Q_ENABLE is on and the
    // vehicle has restarted. Drawn as the row they will become, so the card is
    // one height in every state rather than growing by two rows the moment a
    // reboot lands -- which is the same rule that keeps a status from
    // resizing a card.
    if (disabled) {
      return (
        <div
          className={['la-field', showName ? 'la-field--named' : '', 'la-field--off']
            .filter(Boolean)
            .join(' ')}
        >
          <label className="la-field__label">{label}</label>
          {showName && <span className="la-field__param">{param}</span>}
          <LaSelect disabled value="">
            <option value="">—</option>
          </LaSelect>
          {showName && <span className="la-field__unit">{unit ?? ''}</span>}
        </div>
      )
    }
    return (
      <div className={stacked ? 'la-field la-field--stacked' : 'la-field'}>
        <label className="la-field__label">{label}</label>
        <span className="la-muted">not on this vehicle</span>
      </div>
    )
  }

  // A bitmask has no named values, so without this the field fell through to
  // a plain number box and asked for a mask to be typed -- which is what the
  // Parameters table's own editor exists to avoid. The button says what is
  // switched on rather than the number that says it.
  const control = meta?.bitmask ? (
    <>
      <LaButton
        variant="ghost"
        className="param-bitmask"
        disabled={disabled}
        title={describeBits(entry.value, meta.bitmask, 99)}
        onClick={() => setBitmaskOpen(true)}
      >
        {describeBits(entry.value, meta.bitmask, 2)}
      </LaButton>
      {bitmaskOpen && (
        <BitmaskEditor
          name={param}
          displayName={meta.displayName}
          value={entry.value}
          bitmask={meta.bitmask}
          onApply={(v) => {
            commit(v)
            setBitmaskOpen(false)
          }}
          onCancel={() => setBitmaskOpen(false)}
        />
      )}
    </>
  ) : meta?.values && !numeric ? (
    <LaSelect
      value={String(entry.value)}
      disabled={disabled}
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
      disabled={disabled}
      step={meta?.increment ?? 'any'}
      value={entry.value}
      title={meta?.description ?? param}
      // The platform's own `change` event is the commit, and React's
      // `onChange` is not it -- React maps that to `input`, which fires on
      // every keystroke. `change` fires exactly where a number box means
      // "done": on Enter, on leaving the field, and **immediately on the
      // stepper**, which is the one this missed. Travel is set by nudging a
      // trim and watching the surface, and Up-arrow only staged the value, so
      // nothing moved until you clicked away. Measured in the app: ArrowUp
      // fires input+change, typing "148" fires input alone, Enter fires
      // change.
      // A ref rather than a listener in an effect, because React may hand back
      // a different node across a re-render and this re-attaches when it does
      // (React 19 runs the cleanup a ref returns).
      ref={(node) => {
        if (!node || !writeNow) return undefined
        const onNativeChange = () => commitRef.current(Number(node.value))
        node.addEventListener('change', onNativeChange)
        return () => node.removeEventListener('change', onNativeChange)
      }}
      onChange={(e) => {
        const v = Number(e.target.value)
        // Always stage on the way past, even for a `writeNow` field: the
        // control has to show what is being typed, and the ref above is what
        // sends it.
        if (Number.isFinite(v)) edit(param, v)
      }}
    />
  )

  // A field that writes answers for itself, inside its own control: a card-wide
  // "Saved" left the reader to work out which of several fields it meant, and
  // anywhere outside the control's box would cost the layout a line.
  const placed = writeNow ? (
    <span className="param-control">
      {control}
      <WriteFeedback params={[param]} inline />
    </span>
  ) : (
    control
  )

  if (bare) return placed

  const unitText = unit ?? meta?.units
  return (
    <div
      className={
        [
          stacked ? 'la-field la-field--stacked' : 'la-field',
          showName ? 'la-field--named' : '',
          disabled ? 'la-field--off' : '',
        ]
          .filter(Boolean)
          .join(' ')
      }
      title={meta?.description ?? param}
    >
      {/* Four columns rather than two: what the setting does, the ArduPilot
          name for it, the control, and the unit that qualifies the number in
          it. The words lead because this is a curated screen -- somebody is
          here to change a thing, not to look up an identifier -- and the name
          follows in the same quiet sub-font a unit takes, as the thing to
          carry to the wiki or the Parameters tab once they have found the row.
          The unit sits *after* the box rather than up against the label,
          because it qualifies what is typed in the box and not what the row is
          called; it stays a `.la-field__unit`, which is where the design
          system puts units. */}
      <label className="la-field__label">
        {label} {!showName && unitText && <span className="la-field__unit">{unitText}</span>}
      </label>
      {showName && <span className="la-field__param">{param}</span>}
      {placed}
      {showName && <span className="la-field__unit">{unitText ?? ''}</span>}
    </div>
  )
}
