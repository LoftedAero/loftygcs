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
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useParamStore } from '../../../stores/param-store'
import { MAV_RESULT } from '../../../protocol/commands'
import { useHudNoteStore } from '../../../stores/hud-note-store'
import { HUD_MESSAGE_SEVERITY } from './hud-draw'
import { modeNumberByName, modeTable, vehicleClass } from '../../../protocol/modes'
import {
  arm,
  changeSpeed,
  disarm,
  preflightCalibration,
  rebootAutopilot,
  restartScripting,
  setCurrentMissionItem,
  setGuidedAltitude,
  setModeConfirmed,
  takeoff,
  takeoffStyle,
  triggerCamera,
} from '../../../services/flight'

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

const TAKEOFF_ALT_M = 20

/** How recent a vehicle warning has to be to count as a refusal's reason. */
const REASON_WINDOW_MS = 4000

export default function FlightControls() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const customMode = useVehicleStore((s) => s.customMode)
  const modeNameNow = useVehicleStore((s) => s.modeName)
  const armed = useVehicleStore((s) => s.armed)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const groundspeedMs = useVehicleStore((s) => s.groundspeedMs)
  const units = useUnits()
  const missionSeq = useVehicleStore((s) => s.missionSeq)
  const wpDistM = useVehicleStore((s) => s.wpDistM)
  const planItems = useMissionStore((s) => s.plan.items)
  const progress = missionProgress(missionSeq, planItems, wpDistM, groundspeedMs)
  const isCopter = vehicleClass(vehicleType) === 'copter'
  // How this airframe takes off, from the same function the command uses so
  // the tooltip matches. A quadplane climbs vertically like a copter; only a
  // fixed wing takes off by mode.
  const qEnable = useParamStore((s) => s.entries.get('Q_ENABLE')?.value)
  const takeoffVia = takeoffStyle(vehicleType, qEnable)

  const say = useHudNoteStore((s) => s.say)
  const clearNote = useHudNoteStore((s) => s.clear)
  const [speed, setSpeed] = useState('')
  const [alt, setAlt] = useState('')
  const [wp, setWp] = useState('')
  const [action, setAction] = useState(DO_ACTIONS[0]!.id)
  const [pending, setPending] = useState<DoAction | null>(null)
  const [confirmForce, setConfirmForce] = useState(false)

  const modes = modeTable(vehicleType)

  // The mode picked but not yet sent; null shows the vehicle's actual mode.
  const [pendingMode, setPendingMode] = useState<number | null>(null)
  const shownMode = pendingMode ?? customMode
  const modeStaged = pendingMode !== null && pendingMode !== customMode
  // Any change to the vehicle's mode (our Set, a failsafe, the transmitter)
  // clears the staged one.
  useEffect(() => setPendingMode(null), [customMode])
  const applyMode = () => {
    if (pendingMode === null) return
    void setModeConfirmed(pendingMode).then(report('Mode')).catch(fail('Mode'))
  }

  /**
   * Whether the vehicle has explained a refusal itself. MAV_RESULT only says
   * FAILED; the reason ("Arm: Need Position Estimate") arrives just after the
   * ack as a warning, which the HUD already shows.
   */
  const explained = () =>
    useVehicleStore
      .getState()
      .statusTexts.some(
        (t) => t.severity <= HUD_MESSAGE_SEVERITY && Date.now() - t.at < REASON_WINDOW_MS,
      )

  // Results go to the HUD beside the vehicle's own warnings. Success says
  // nothing (the vehicle state is the confirmation) but clears any earlier
  // refusal.
  const report = (what: string) => async (result: number) => {
    if (result === 0) return clearNote()
    // The vehicle usually explains itself just after the ack, not with it.
    await new Promise((r) => setTimeout(r, 400))
    if (!explained()) say(`${what}: ${MAV_RESULT[result] ?? result}`)
  }
  const fail = (what: string) => (err: unknown) =>
    say(`${what}: ${err instanceof Error ? err.message : 'no answer'}`)

  const jump = (name: string) => {
    const num = modeNumberByName(vehicleType, name)
    if (num === undefined) {
      say(`${name} is not a mode on this vehicle`)
      return
    }
    void setModeConfirmed(num)
      .then(async (r) => {
        await report(name)(r)
        // Copter will not start an Auto takeoff from the ground until the
        // throttle stick is raised, which a GCS without a transmitter cannot
        // do; otherwise it sits armed in Auto until it auto-disarms.
        if (r === 0 && name === 'Auto' && isCopter && relAltM < 1) {
          say('Copter will not start an Auto takeoff from the ground')
        }
      })
      .catch(fail(name))
  }

  const onArmClick = () => {
    if (armed) {
      void disarm().then(report('Disarm')).catch(fail('Disarm'))
      return
    }
    void arm()
      .then((result) => {
        if (result === 0) clearNote()
        else {
          // Refused: the vehicle's reason is on the HUD; offer force-arm
          // behind an explicit danger confirm.
          if (!explained()) say(`Arm: ${MAV_RESULT[result] ?? result}`)
          setConfirmForce(true)
        }
      })
      .catch(fail('Arm'))
  }

  const run = (a: DoAction) => {
    if (a.confirm) setPending(a)
    else void a.run().then(report(a.label)).catch(fail(a.label))
  }

  return (
    <div className="flight-controls">
      {/* Tier one: flight mode and arm state. */}
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
            onClick={() => {
              // A copter's EKF refuses Guided for a few seconds after boot; the
              // vehicle's reason ("requires position") shows on the HUD.
              void takeoff(TAKEOFF_ALT_M).then(report('Takeoff')).catch(fail('Takeoff'))
            }}
          >
            Takeoff
          </LaButton>
          <LaButton variant="secondary" disabled={!connected} onClick={() => jump('Auto')}>
            Auto
          </LaButton>
          <LaButton variant="secondary" disabled={!connected} onClick={() => jump('RTL')}>
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

      {/* Tier three, on a recessed strip: values to adjust in flight, then
          occasional commands. */}
      <div className="flight-controls__secondary">
        {/* Typed in display units, converted to SI before sending. */}
        <Field
          id="fc-speed"
          label="Speed"
          unit={speedLabel(units.speed)}
          value={speed}
          placeholder={groundspeedMs ? formatSpeed(groundspeedMs, units.speed, 0) : '—'}
          onChange={setSpeed}
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
          disabled={!connected}
          onSet={() =>
            void setCurrentMissionItem(Number(wp)).then(report('Set item')).catch(fail('Set item'))
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

      <LaModal
        open={confirmForce}
        title="Force arm?"
        actions={
          <>
            <LaButton variant="ghost" onClick={() => setConfirmForce(false)}>
              Cancel
            </LaButton>
            <LaButton
              variant="danger"
              onClick={() => {
                setConfirmForce(false)
                void arm(true).then(report('Force arm')).catch(fail('Force arm'))
              }}
            >
              Force arm
            </LaButton>
          </>
        }
      >
        <p>A preflight check failed. Force arm skips it rather than fixing it.</p>
      </LaModal>
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
  onChange,
  onSet,
}: {
  id: string
  label: string
  unit?: string
  value: string
  placeholder: string
  disabled: boolean
  onChange: (v: string) => void
  onSet: () => void
}) {
  return (
    <div className="flight-controls__field">
      <label className="la-field__label" htmlFor={id}>
        {label} {unit && <span className="la-field__unit">{unit}</span>}
      </label>
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
      <LaButton variant="secondary" disabled={disabled || value === ''} onClick={onSet}>
        Set
      </LaButton>
    </div>
  )
}
