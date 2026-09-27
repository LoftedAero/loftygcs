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

// Every command you give the vehicle, in one place.
//
// They used to be spread across three: mode and arm in the app's footer,
// these in a bar under the HUD, and the view switches in a strip under the
// header. The footer's justification was that it never scrolls away -- but
// nothing on this screen scrolls, so the split bought nothing and cost the
// pilot a hunt. The view switches moved out to a Layout menu, and Follow
// moved onto the map it belongs to.
//
// Ordered by how often a hand reaches for them: flying, then adjusting,
// then the occasional command behind a picker.

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
    confirm:
      'Onboard Lua scripts will stop and start again. Anything they were doing is interrupted.',
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
  // How this airframe leaves the ground, from the same function the command
  // uses -- so the tooltip cannot promise one thing while Takeoff does
  // another. A quadplane goes the copter's way (vertically, to the altitude
  // asked for); only a fixed wing takes off by mode.
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

  // The mode picked but not yet sent. Null means "showing what the vehicle
  // is actually in", which is what it shows whenever nothing is staged.
  const [pendingMode, setPendingMode] = useState<number | null>(null)
  const shownMode = pendingMode ?? customMode
  const modeStaged = pendingMode !== null && pendingMode !== customMode
  // Any change to the vehicle's own mode clears the staged one -- our Set
  // landing, but also a failsafe or a switch on the transmitter. A staged
  // choice made before the situation changed is not one to keep offering.
  useEffect(() => setPendingMode(null), [customMode])
  const applyMode = () => {
    if (pendingMode === null) return
    void setModeConfirmed(pendingMode).then(report('Mode')).catch(fail('Mode'))
  }

  /**
   * Whether the vehicle has explained a refusal itself.
   *
   * MAV_RESULT says FAILED and nothing else; the reason -- "Arm: Need
   * Position Estimate", "Mode change to Guided failed: requires position" --
   * arrives just after the ack as a warning, which the HUD shows. Only a
   * refusal it did not explain needs the app to say anything.
   */
  const explained = () =>
    useVehicleStore
      .getState()
      .statusTexts.some(
        (t) => t.severity <= HUD_MESSAGE_SEVERITY && Date.now() - t.at < REASON_WINDOW_MS,
      )

  // Results go to the HUD, where the vehicle's own warnings are (Mission
  // Planner's arrangement), not to a line under these buttons. Success says
  // nothing: the mode, the armed state, the altitude are the confirmation.
  // It does clear what an earlier refusal left there.
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
        // Auto with a takeoff as its first item will not start itself from
        // the ground: Copter waits for the throttle stick to be raised,
        // which a station with no transmitter cannot do. Say so rather than
        // leaving a vehicle that is armed, in Auto, and going nowhere until
        // it auto-disarms.
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
      {/* Tier one: what mode it is in and whether it is armed. Full size and
          first, because everything else is an adjustment to these two. */}
      <div className="flight-controls__primary">
        {/* Two groups that wrap as wholes: in a narrow column the jumps go
            under the mode and Arm, rather than a row breaking between any
            two buttons. The gap between them is what makes them groups; the
            rule that used to divide them sat alone at the start of the
            second line once they wrapped. */}
        <div className="flight-controls__group">
          {/* Chosen, then sent -- not sent on change.
            A <select> takes the mouse wheel, so a scroll that happens to
            pass over this one used to command a mode change on a flying
            aircraft, with nothing pressed and nothing confirmed. Staging
            the choice also makes this the same gesture as the value fields
            below and as a parameter edit: pick, then commit. The staged
            state wears `.is-dirty`, which is the app's existing "this is
            what the button will send" highlight. */}
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
          <LaButton
            variant="secondary"
            disabled={!connected || !modeStaged}
            title="Send the selected flight mode"
            onClick={applyMode}
          >
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
          {/* Tier two: one-touch jumps that are really mode changes, so they
            sit beside the mode picker but a step down in size. */}
          {/* Just "Takeoff". The altitude was in the label, but what the
            command actually does differs by airframe, and one honest word
            beats a number that is only true for some of them -- measured
            against SITL, armed and in Guided: a quadplane answers
            NAV_TAKEOFF with ACCEPTED and a fixed wing with FAILED. The
            altitude is on the tooltip. */}
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
              // vehicle says so ("requires position"), and that is on the HUD.
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

        {/* Read, not pressed -- so it takes the top row's right-hand end,
            which was the one piece of always-visible space on this screen
            and was empty. It also stops a read-only readout sitting in the
            middle of the strip of controls below. */}
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

      {/* Tier three, on a recessed strip: numbers you nudge while it is up
          there, then the occasional command, then arranging the window.
          Ordered by how often a hand goes to them. */}
      <div className="flight-controls__secondary">
        {/* Typed in the reader's units and converted on the way out: the
            vehicle is commanded in SI whatever the box says. */}
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
        {/* Labelled like the fields beside it, and one group, so a wrap takes
            both or neither and the line it lands on reads as a fourth field
            rather than a stray at the right-hand edge. */}
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
        <p>
          The vehicle refused to arm, which means one of its own preflight checks failed. Forcing
          past that skips the check rather than fixing it.
        </p>
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
        // Enter is what a hand does after typing a number; making it wait
        // for a mouse trip to the button is the wrong shape in flight.
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
