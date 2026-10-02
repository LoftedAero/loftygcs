import { Fragment, useState } from 'react'
import { LaButton, LaInput, LaModal, LaSelect } from '../components/La'
import {
  CALLOUTS,
  CALLOUT_GROUPS,
  beepKindOf,
  modesOf,
  type CalloutDef,
  type CalloutId,
  type CalloutMode,
  type ThresholdUnit,
} from '../../services/voice/catalog'
import {
  calloutMode,
  calloutValue,
  usePreferencesStore,
  useUnits,
} from '../../stores/preferences-store'
import {
  distanceLabel,
  fromDistance,
  fromSpeed,
  speedLabel,
  toDistance,
  toSpeed,
  type UnitPrefs,
} from '../../units'

// Every callout, each spoken, a beep, or off, with its threshold where it has
// one. Opened from Preferences' Configure, since these are set once.

const MODE_LABEL: Record<CalloutMode, string> = { voice: 'Voice', beep: 'Beep', off: 'Off' }

function modeLabel(def: CalloutDef, mode: CalloutMode): string {
  if (mode !== 'beep') return MODE_LABEL[mode]
  return beepKindOf(def) === 'warn' ? 'Warning beep' : 'Info beep'
}

/** A threshold as shown, in the user's units, and back. */
function display(unit: ThresholdUnit, v: number, units: UnitPrefs): number {
  if (unit === 'distance') return Math.round(toDistance(v, units.distance))
  if (unit === 'speed') return Math.round(toSpeed(v, units.speed))
  return v
}
function stored(unit: ThresholdUnit, v: number, units: UnitPrefs): number {
  if (unit === 'distance') return fromDistance(v, units.distance)
  if (unit === 'speed') return fromSpeed(v, units.speed)
  return v
}
function unitLabel(unit: ThresholdUnit, units: UnitPrefs): string {
  switch (unit) {
    case 'distance':
      return distanceLabel(units.distance)
    case 'speed':
      return speedLabel(units.speed)
    case 'percent':
      return '%'
    case 'seconds':
      return 's'
    case 'minutes':
      return 'min'
    case 'voltsPerCell':
      return 'V/cell'
  }
}

/** A number box that commits on Enter or leaving it, so typing passes through no limit. */
function Threshold({ def, disabled }: { def: CalloutDef; disabled: boolean }) {
  const units = useUnits()
  const voice = usePreferencesStore((s) => s.voice)
  const setValue = usePreferencesStore((s) => s.setCalloutValue)
  const t = def.threshold!
  const shown = display(t.unit, calloutValue(voice, def.id as CalloutId), units)
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n)) {
      setValue(def.id as CalloutId, stored(t.unit, n, units))
    }
    setDraft(null)
  }
  return (
    <span className="callouts__threshold">
      <span className="la-field__unit">{t.relation}</span>
      <LaInput
        num
        type="number"
        aria-label={`${def.label} threshold`}
        step={t.step}
        disabled={disabled}
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <span className="la-field__unit">{unitLabel(t.unit, units)}</span>
    </span>
  )
}

export default function VoiceCalloutsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const voice = usePreferencesStore((s) => s.voice)
  const setMode = usePreferencesStore((s) => s.setCalloutMode)
  const reset = usePreferencesStore((s) => s.resetCallouts)

  return (
    <LaModal
      open={open}
      wide
      title="Voice callouts"
      actions={
        <>
          <LaButton variant="ghost" onClick={reset}>
            Reset to defaults
          </LaButton>
          <LaButton variant="primary" onClick={onClose}>
            Done
          </LaButton>
        </>
      }
    >
      <div className="callouts">
        {CALLOUT_GROUPS.map((g) => (
          <Fragment key={g.id}>
            <h3 className="prefs__head callouts__head">{g.label}</h3>
            {CALLOUTS.filter((c) => c.group === g.id).map((c: CalloutDef) => {
              const id = c.id as CalloutId
              const mode = calloutMode(voice, id)
              return (
                <div className="callouts__row" key={c.id}>
                  <label className="callouts__label" htmlFor={`callout-${c.id}`}>
                    {c.label}
                  </label>
                  {c.threshold ? <Threshold def={c} disabled={mode === 'off'} /> : <span />}
                  <LaSelect
                    id={`callout-${c.id}`}
                    value={mode}
                    onChange={(e) => setMode(id, e.target.value as CalloutMode)}
                  >
                    {modesOf(c).map((m) => (
                      <option key={m} value={m}>
                        {modeLabel(c, m)}
                      </option>
                    ))}
                  </LaSelect>
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </LaModal>
  )
}
