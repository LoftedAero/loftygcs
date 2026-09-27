import { useRef, useState } from 'react'
import { LaButton, LaSelect } from './La'
import BitmaskEditor, { countBits, describeBits } from './BitmaskEditor'
import { shortOption } from './option-names'
import WriteFeedback from './WriteFeedback'
import { useParamStore } from '../../stores/param-store'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { connectionService } from '../../services/connection'

// One control bound to a parameter by name, the building block of every
// curated view. Edits stage in the param store like the Parameters tab, and
// the owning card or column's Write sends them together.
//
// `bare` drops the label wrapper for table layouts (Ports, Outputs), where
// the column heading is the label.
//
// `writeNow` writes immediately instead of staging, for parameters whose
// effect the screen needs to show right away (OSD_TYPE: at 0 the vehicle
// reports no panel positions). It never writes on a keystroke: a dropdown
// writes on change, a number field on Enter, blur or the stepper, so typing
// "50" does not send 5 first.
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
  withValues,
  optionLabels,
  bitmaskCount,
  shortOptions,
}: {
  param: string
  label: string
  unit?: string
  bare?: boolean
  writeNow?: boolean
  /**
   * Re-read the parameter set after writing this one. Only for a parameter
   * that exposes or hides others (OSD_TYPE). Separate from `writeNow`
   * because a full refresh is ~1,400 parameters, tens of seconds over a
   * telemetry radio, and most immediate writes do not change the set.
   */
  gatesOthers?: boolean
  /** Label above the control rather than beside it, as `LaField`'s `stacked`. */
  stacked?: boolean
  /**
   * Show the ArduPilot parameter name beside the label, so it can be matched
   * to the wiki and the Parameters tab. Setup screens opt in.
   */
  showName?: boolean
  /**
   * Greyed out because another setting makes it irrelevant (an airspeed
   * sensor's type while the sensor is disabled). Greyed rather than hidden so
   * the card layout does not shift.
   */
  disabled?: boolean
  /**
   * Edit as a number even though ArduPilot names some values. On a
   * continuous parameter `@Values` are suggestions (MOT_SPIN_MIN names 0.0,
   * 0.15 and 0.25 over 0 to 0.25), and a dropdown could not show or accept
   * the values in between.
   *
   * Declared per field rather than inferred from having both Values and
   * Range: BATT_VOLT_PIN has both, and its values belong in a list.
   */
  numeric?: boolean
  /**
   * Show each named value's number beside its name: "Crisp (0.1)". For names
   * that are presets on a physical scale (ATC_INPUT_TC's time constants),
   * not for enumerations where the number is just an index.
   */
  withValues?: boolean
  /**
   * Short names for a dropdown's values where ArduPilot's are sentences
   * (OSD_SW_METHOD). The full text of the chosen value is the hover text; an
   * unlisted value keeps its own name.
   */
  optionLabels?: Record<number, string>
  /**
   * Show a bitmask as a count ("2 selected", "none") rather than names, for
   * controls too narrow for a name. The names are the hover text.
   */
  bitmaskCount?: boolean
  /**
   * ArduPilot's sentence-length value names, shortened (`option-names.ts`):
   * "Yes(minimum PWM when disarmed)" as "Yes, min PWM". The full name of the
   * chosen value is the hover text.
   */
  shortOptions?: boolean
}) {
  const entry = useParamStore((s) => s.entries.get(param))
  const meta = useParamStore((s) => s.metadata[param])
  const edit = useParamStore((s) => s.edit)
  const [bitmaskOpen, setBitmaskOpen] = useState(false)
  // The commit, reachable from a native listener that outlives this render.
  const commitRef = useRef<(v: number) => void>(() => {})

  /**
   * Write immediately when `writeNow`, otherwise stage. A failed write falls
   * back to staging so the chosen value is kept.
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
        // ArduPilot's metadata says which parameters are read only at boot.
        if (meta?.rebootRequired) {
          useWriteFeedbackStore.getState().needReboot(`${param} takes effect after a restart`)
        }
        if (!gatesOthers) return
        // A quiet refresh skips `beginDownload`, so curated tabs are not
        // blanked, and merges rather than rebuilding, so staged edits survive.
        // The app bar's progress bar still shows it.
        return connectionService.refreshParams({ quiet: true })
      })
      .catch((err: unknown) => {
        // Keep the chosen value as a staged edit.
        edit(param, v)
        useWriteFeedbackStore.getState().report({
          ok: false,
          param,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }

  commitRef.current = commit

  // A single named value is a sentinel, not a list: 4.7's BATT_VOLT_PIN names
  // only -1 ("Disabled"), and a dropdown would offer no other pin.
  const listed = Object.keys(meta?.values ?? {}).length > 1

  if (!entry) {
    if (bare) {
      // A disabled row the card always draws gets an empty greyed control.
      return disabled ? (
        <LaSelect disabled value="">
          <option value="">—</option>
        </LaSelect>
      ) : (
        <span className="la-muted">—</span>
      )
    }
    // Disabled and not yet created by the firmware, such as the quadplane
    // frame fields before Q_ENABLE and a restart. Drawn as the row it will
    // become, so the card keeps its height.
    if (disabled) {
      return (
        <div
          className={['la-field', showName ? 'la-field--named' : '', 'la-field--off']
            .filter(Boolean)
            .join(' ')}
        >
          <label className="la-field__label">{label}</label>
          {showName && <span className="la-field__param">{param}</span>}
          {/* The metadata already says which kind of control it will be. */}
          {listed || meta?.bitmask ? (
            <LaSelect disabled value="">
              <option value="">—</option>
            </LaSelect>
          ) : (
            <input className="la-input la-input--num" type="number" disabled placeholder="—" />
          )}
          {showName && <span className="la-field__unit">{unit ?? meta?.units ?? ''}</span>}
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

  // A bitmask opens the bit editor; the button shows which options are set
  // rather than the raw number.
  const control = meta?.bitmask ? (
    <>
      <LaButton
        variant="ghost"
        className="param-bitmask"
        disabled={disabled}
        title={describeBits(entry.value, meta.bitmask, 99)}
        onClick={() => setBitmaskOpen(true)}
      >
        {/* A separate element so text-overflow ellipsis applies; text directly
            in the button's flex box is clipped without one. */}
        <span className="param-bitmask__text">
          {bitmaskCount
            ? countBits(entry.value, meta.bitmask)
            : describeBits(entry.value, meta.bitmask, 2)}
        </span>
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
  ) : meta?.values && listed && !numeric ? (
    <LaSelect
      value={String(entry.value)}
      disabled={disabled}
      onChange={(e) => commit(Number(e.target.value))}
      className={entry.dirty ? 'is-dirty' : ''}
      title={
        optionLabels || shortOptions
          ? (meta.values[entry.value] ?? meta.description ?? param)
          : (meta.description ?? param)
      }
    >
      {Object.entries(meta.values).map(([v, l]) => (
        <option key={v} value={v}>
          {optionLabels?.[Number(v)] ??
            (shortOptions ? shortOption(l) : withValues ? `${l} (${v})` : l)}
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
      // The native `change` event is the commit; React's `onChange` is really
      // `input` and fires on every keystroke. `change` fires on Enter, on
      // blur and immediately on the stepper arrows.
      // Attached in a ref callback so it follows the node across re-renders
      // (React 19 runs the cleanup a ref returns).
      ref={(node) => {
        if (!node || !writeNow) return undefined
        const onNativeChange = () => commitRef.current(Number(node.value))
        node.addEventListener('change', onNativeChange)
        return () => node.removeEventListener('change', onNativeChange)
      }}
      onChange={(e) => {
        const v = Number(e.target.value)
        // Always stage so the control shows what is typed; for `writeNow` the
        // ref above does the sending.
        if (Number.isFinite(v)) edit(param, v)
      }}
    />
  )

  // A field that writes shows its own feedback inside the control, so it is
  // clear which field it refers to and the layout does not change.
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
      className={[
        stacked ? 'la-field la-field--stacked' : 'la-field',
        showName ? 'la-field--named' : '',
        disabled ? 'la-field--off' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={meta?.description ?? param}
    >
      {/* With showName, four columns: label, ArduPilot name, control, unit.
          The unit follows the box because it qualifies the value. */}
      <label className="la-field__label">
        {label} {!showName && unitText && <span className="la-field__unit">{unitText}</span>}
      </label>
      {showName && <span className="la-field__param">{param}</span>}
      {placed}
      {showName && <span className="la-field__unit">{unitText ?? ''}</span>}
    </div>
  )
}
