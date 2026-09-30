import { useEffect, useState } from 'react'
import { useMissionStore } from '../../../stores/mission-store'
import { formatEta, missionProgress } from './mission-progress'
import { useUnits } from '../../../stores/preferences-store'
import {
  distanceLabel,
  formatDistance,
  formatSpeed,
  fromDistance,
  fromSpeed,
  speedLabel,
} from '../../../units'
import { LaButton, LaModal, LaSelect } from '../../components/La'
import { useVehicleStore } from '../../../stores/vehicle-store'
import {
  changeSpeed,
  preflightCalibration,
  rebootAutopilot,
  restartScripting,
  setCurrentMissionItem,
  setGuidedAltitude,
  triggerCamera,
} from '../../../services/flight'
import { TAKEOFF_ALT_M, useFlightActions } from './useFlightActions'

// Every command you give the vehicle, in one place, ordered by how often they
// are used: flying, then adjusting, then occasional commands behind a picker.

interface DoAction {
  id: string
  label: string
  run: () => Promise<number>
  /** Actions that interrupt flight get an explicit confirmation. */
  confirm?: string
}

const DO_ACTIONS: DoAction[] = [
  { id: 'calibrate', label: 'Preflight calibration', run: preflightCalibration },
  { id: 'trigger', label: 'Trigger camera now', run: triggerCamera },
  {
    id: 'scripting',
    label: 'Stop and restart scripting',
    run: restartScripting,
    confirm: 'Anything the Lua scripts are doing is interrupted.',
  },
  {
    id: 'reboot',
    label: 'Reboot autopilot',
    run: rebootAutopilot,
    confirm:
      'The autopilot reboots and the link drops. Never do this in the air — the vehicle will fall.',
  },
]

/**
 * `part` renders one tier alone, for compact mode, which puts the flight
 * actions in a column beside the map and the adjustments in a sheet; `compact`
 * gives the number fields steppers, since a touch screen's keyboard covers half
 * of it.
 */
export default function FlightControls({
  part,
  compact = false,
}: { part?: 'primary' | 'secondary'; compact?: boolean } = {}) {
  const actions = useFlightActions()
  const { connected, armed, modes, takeoffVia, report, fail, clearNote } = actions
  const customMode = useVehicleStore((s) => s.customMode)
  const modeNameNow = useVehicleStore((s) => s.modeName)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const groundspeedMs = useVehicleStore((s) => s.groundspeedMs)
  const units = useUnits()
  const missionSeq = useVehicleStore((s) => s.missionSeq)
  const wpDistM = useVehicleStore((s) => s.wpDistM)
  const planItems = useMissionStore((s) => s.plan.items)
  const progress = missionProgress(missionSeq, planItems, wpDistM, groundspeedMs)

  const [speed, setSpeed] = useState('')
  const [alt, setAlt] = useState('')
  const [wp, setWp] = useState('')
  const [action, setAction] = useState(DO_ACTIONS[0]!.id)
  const [pending, setPending] = useState<DoAction | null>(null)

  // The mode picked but not yet sent; null shows the vehicle's actual mode.
  const [pendingMode, setPendingMode] = useState<number | null>(null)
  const shownMode = pendingMode ?? customMode
  const modeStaged = pendingMode !== null && pendingMode !== customMode
  // Any change to the vehicle's mode (our Set, a failsafe, the transmitter)
  // clears the staged one.
  useEffect(() => setPendingMode(null), [customMode])
  const applyMode = () => {
    if (pendingMode !== null) actions.setMode(pendingMode)
  }

  const onArmClick = () => (armed ? actions.disarm() : actions.arm())

  const run = (a: DoAction) => {
    if (a.confirm) setPending(a)
    else void a.run().then(report(a.label)).catch(fail(a.label))
  }

  return (
    <div className={`flight-controls${compact ? ' flight-controls--compact' : ''}`}>
      {/* Tier one: flight mode and arm state. */}
      {part !== 'secondary' && (
        <div className="flight-controls__primary">
          {/* Two groups that wrap as wholes in a narrow column. */}
          <div className="flight-controls__group">
            {/* Chosen, then sent with Set. A <select> takes the mouse wheel, so
            sending on change would let a stray scroll change the mode in
            flight. `.is-dirty` marks a staged choice. */}
            <LaSelect
              className={`flight-controls__mode${modeStaged ? ' is-dirty' : ''}`}
              value={String(shownMode)}
              disabled={!connected}
              aria-label="Flight mode"
              onChange={(e) => setPendingMode(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && modeStaged) applyMode()
              }}
            >
              {Object.entries(modes).map(([num, name]) => (
                <option key={num} value={num}>
                  {name}
                </option>
              ))}
              {modes[shownMode] === undefined && (
                <option value={String(shownMode)}>{modeNameNow}</option>
              )}
            </LaSelect>
            <LaButton variant="secondary" disabled={!connected || !modeStaged} onClick={applyMode}>
              Set
            </LaButton>
            <LaButton
              variant={armed ? 'danger' : 'primary'}
              disabled={!connected}
              onClick={onArmClick}
            >
              {armed ? 'Disarm' : 'Arm'}
            </LaButton>
          </div>

          <div className="flight-controls__group">
            {/* Tier two: one-touch jumps that are really mode changes. */}
            {/* No altitude in the label: what Takeoff does differs by airframe,
            so the details are on the tooltip. */}
            <LaButton
              variant="secondary"
              title={
                takeoffVia === 'guided'
                  ? `Climb to ${formatDistance(TAKEOFF_ALT_M, units.distance, 0)} ${distanceLabel(units.distance)}`
                  : 'Switch to Takeoff mode and climb to the vehicle’s TKOFF_ALT'
              }
              disabled={!connected || !armed || takeoffVia === 'unsupported'}
              onClick={actions.takeoff}
            >
              Takeoff
            </LaButton>
            <LaButton
              variant="secondary"
              disabled={!connected}
              onClick={() => actions.jump('Auto')}
            >
              Auto
            </LaButton>
            <LaButton variant="secondary" disabled={!connected} onClick={() => actions.jump('RTL')}>
              RTL
            </LaButton>
          </div>

          {/* A readout, not a control, so it sits at the right end of the top
            row rather than among the controls. */}
          {progress.position !== null && (
            <span className="flight-progress" title="Mission item the vehicle is flying">
              <span className="flight-progress__label">WP</span>
              <span className="flight-progress__value">{progress.position}</span>
              {progress.commandName && (
                <span className="flight-progress__name">{progress.commandName}</span>
              )}
              {wpDistM !== null && (
                <span className="flight-progress__value">
                  {formatDistance(wpDistM, units.distance, 0)} {distanceLabel(units.distance)}
                </span>
              )}
              {progress.etaS !== null && (
                <span className="flight-progress__eta">{formatEta(progress.etaS)}</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Tier three, on a recessed strip: values to adjust in flight, then
          occasional commands. */}
      {part !== 'primary' && (
        <div className="flight-controls__secondary">
          {/* Typed in display units, converted to SI before sending. */}
          <Field
            id="fc-speed"
            label="Speed"
            unit={speedLabel(units.speed)}
            value={speed}
            placeholder={groundspeedMs ? formatSpeed(groundspeedMs, units.speed, 0) : '—'}
            onChange={setSpeed}
            {...(compact ? { step: 1 } : {})}
            disabled={!connected}
            onSet={() =>
              void changeSpeed(fromSpeed(Number(speed), units.speed))
                .then(report('Speed'))
                .catch(fail('Speed'))
            }
          />
          <Field
            id="fc-alt"
            label="Altitude"
            unit={distanceLabel(units.distance)}
            value={alt}
            placeholder={relAltM ? formatDistance(relAltM, units.distance, 0) : '—'}
            onChange={setAlt}
            {...(compact ? { step: 5 } : {})}
            disabled={!connected}
            onSet={() => {
              setGuidedAltitude(fromDistance(Number(alt), units.distance))
              clearNote()
            }}
          />
          <Field
            id="fc-wp"
            label="Item"
            value={wp}
            placeholder="#"
            onChange={setWp}
            {...(compact ? { step: 1 } : {})}
            disabled={!connected}
            onSet={() =>
              void setCurrentMissionItem(Number(wp))
                .then(report('Set item'))
                .catch(fail('Set item'))
            }
          />
          {/* Labeled like the fields beside it, and one group so it wraps as a
            whole. */}
          <div className="flight-controls__run">
            <label className="la-field__label" htmlFor="fc-action">
              Action
            </label>
            <LaSelect
              id="fc-action"
              className="flight-controls__action"
              value={action}
              disabled={!connected}
              aria-label="Action to run"
              onChange={(e) => setAction(e.target.value)}
            >
              {DO_ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </LaSelect>
            <LaButton
              variant="secondary"
              disabled={!connected}
              onClick={() => {
                const a = DO_ACTIONS.find((x) => x.id === action)
                if (a) run(a)
              }}
            >
              Run
            </LaButton>
          </div>
        </div>
      )}

      <LaModal
        open={pending !== null}
        title={pending?.label ?? ''}
        actions={
          <>
            <LaButton variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </LaButton>
            <LaButton
              variant="danger"
              onClick={() => {
                const a = pending
                setPending(null)
                if (a) void a.run().then(report(a.label)).catch(fail(a.label))
              }}
            >
              {pending?.label}
            </LaButton>
          </>
        }
      >
        <p>{pending?.confirm}</p>
      </LaModal>

      {actions.forceArmDialog}
    </div>
  )
}

function Field({
  id,
  label,
  unit,
  value,
  placeholder,
  disabled,
  step,
  onChange,
  onSet,
}: {
  id: string
  label: string
  unit?: string
  value: string
  placeholder: string
  disabled: boolean
  /** Adds − and + buttons that move the value by this much. */
  step?: number
  onChange: (v: string) => void
  onSet: () => void
}) {
  // A stepper starts from what is typed, else from the current reading.
  const nudge = (by: number) => {
    const base = Number(value !== '' ? value : placeholder)
    onChange(String(Math.max(0, (Number.isFinite(base) ? base : 0) + by)))
  }
  return (
    <div className="flight-controls__field">
      <label className="la-field__label" htmlFor={id}>
        {label} {unit && <span className="la-field__unit">{unit}</span>}
      </label>
      {step !== undefined && (
        <LaButton
          variant="ghost"
          disabled={disabled}
          aria-label={`${label} down`}
          onClick={() => nudge(-step)}
        >
          −
        </LaButton>
      )}
      <input
        id={id}
        className="la-input la-input--num flight-controls__num"
        type="number"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        // Enter sends, as well as the Set button.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value !== '') onSet()
        }}
      />
      {step !== undefined && (
        <LaButton
          variant="ghost"
          disabled={disabled}
          aria-label={`${label} up`}
          onClick={() => nudge(step)}
        >
          +
        </LaButton>
      )}
      <LaButton variant="secondary" disabled={disabled || value === ''} onClick={onSet}>
        Set
      </LaButton>
    </div>
  )
}
