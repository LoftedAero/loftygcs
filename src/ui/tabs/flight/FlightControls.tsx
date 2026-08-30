import { useState } from 'react'
import { LaButton, LaModal, LaSelect } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { MAV_RESULT } from '../../../protocol/commands'
import { modeNumberByName, modeTable } from '../../../protocol/modes'
import {
  arm,
  changeSpeed,
  disarm,
  preflightCalibration,
  rebootAutopilot,
  restartScripting,
  setCurrentMissionItem,
  setGuidedAltitude,
  setMode,
  takeoff,
  triggerCamera,
} from '../../../services/flight'
import LayoutMenu from './LayoutMenu'

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

export default function FlightControls() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const customMode = useVehicleStore((s) => s.customMode)
  const modeNameNow = useVehicleStore((s) => s.modeName)
  const armed = useVehicleStore((s) => s.armed)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const groundspeedMs = useVehicleStore((s) => s.groundspeedMs)

  const [status, setStatus] = useState('')
  const [speed, setSpeed] = useState('')
  const [alt, setAlt] = useState('')
  const [wp, setWp] = useState('')
  const [action, setAction] = useState(DO_ACTIONS[0]!.id)
  const [pending, setPending] = useState<DoAction | null>(null)
  const [confirmForce, setConfirmForce] = useState(false)

  const modes = modeTable(vehicleType)
  const report = (what: string) => (result: number) =>
    setStatus(result === 0 ? `${what}: accepted` : `${what}: ${MAV_RESULT[result] ?? result}`)
  const fail = (what: string) => (err: unknown) =>
    setStatus(`${what}: ${err instanceof Error ? err.message : 'no answer'}`)

  const jump = (name: string) => {
    const num = modeNumberByName(vehicleType, name)
    if (num === undefined) {
      setStatus(`${name} is not a mode on this vehicle`)
      return
    }
    void setMode(num).then(report(name)).catch(fail(name))
  }

  const onArmClick = () => {
    if (armed) {
      void disarm().then(report('Disarm')).catch(fail('Disarm'))
      return
    }
    void arm()
      .then((result) => {
        if (result === 0) setStatus('Arm: accepted')
        else {
          // Refused: offer force-arm behind an explicit danger confirm.
          setStatus(`Arm: ${MAV_RESULT[result] ?? result}`)
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
        <LaSelect
          className="flight-controls__mode"
          value={String(customMode)}
          disabled={!connected}
          aria-label="Flight mode"
          onChange={(e) =>
            void setMode(Number(e.target.value)).then(report('Mode')).catch(fail('Mode'))
          }
        >
          {Object.entries(modes).map(([num, name]) => (
            <option key={num} value={num}>
              {name}
            </option>
          ))}
          {modes[customMode] === undefined && (
            <option value={String(customMode)}>{modeNameNow}</option>
          )}
        </LaSelect>
        <LaButton
          variant={armed ? 'danger' : 'primary'}
          size="lg"
          disabled={!connected}
          onClick={onArmClick}
        >
          {armed ? 'Disarm' : 'Arm'}
        </LaButton>

        <span className="flight-controls__sep" />

        {/* Tier two: one-touch jumps that are really mode changes, so they
            sit beside the mode picker but a step down in size. */}
        <LaButton
          variant="secondary"
          disabled={!connected || !armed}
          onClick={() =>
            void takeoff(TAKEOFF_ALT_M).then(report('Takeoff')).catch(fail('Takeoff'))
          }
        >
          Takeoff {TAKEOFF_ALT_M} m
        </LaButton>
        <LaButton variant="secondary" disabled={!connected} onClick={() => jump('Auto')}>
          Auto
        </LaButton>
        <LaButton variant="secondary" disabled={!connected} onClick={() => jump('RTL')}>
          RTL
        </LaButton>
      </div>

      {/* Tier three, on a recessed strip: numbers you nudge while it is up
          there, then the occasional command, then arranging the window.
          Ordered by how often a hand goes to them. */}
      <div className="flight-controls__secondary">
        <Field
          id="fc-speed"
          label="Speed"
          unit="m/s"
          value={speed}
          placeholder={groundspeedMs ? groundspeedMs.toFixed(0) : '—'}
          onChange={setSpeed}
          disabled={!connected}
          onSet={() => void changeSpeed(Number(speed)).then(report('Speed')).catch(fail('Speed'))}
        />
        <Field
          id="fc-alt"
          label="Altitude"
          unit="m"
          value={alt}
          placeholder={relAltM ? relAltM.toFixed(0) : '—'}
          onChange={setAlt}
          disabled={!connected}
          onSet={() => {
            setGuidedAltitude(Number(alt))
            setStatus('Altitude: sent')
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
        <span className="la-grow" />
        <LaSelect
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
          size="sm"
          disabled={!connected}
          onClick={() => {
            const a = DO_ACTIONS.find((x) => x.id === action)
            if (a) run(a)
          }}
        >
          Run
        </LaButton>
        <span className="flight-controls__sep" />
        {/* Arranging the window is not a command at all, so it sits at the
            quiet end of the quiet row. */}
        <LayoutMenu />
      </div>

      {status && <p className="la-hint flight-controls__status">{status}</p>}

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
      <LaButton variant="secondary" size="sm" disabled={disabled || value === ''} onClick={onSet}>
        Set
      </LaButton>
    </div>
  )
}
