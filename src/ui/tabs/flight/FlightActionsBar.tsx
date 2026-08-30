import { useState } from 'react'
import { LaButton, LaHint, LaModal, LaSelect } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { MAV_RESULT } from '../../../protocol/commands'
import { modeNumberByName } from '../../../protocol/modes'
import {
  changeSpeed,
  preflightCalibration,
  rebootAutopilot,
  restartScripting,
  setCurrentMissionItem,
  setGuidedAltitude,
  setMode,
  triggerCamera,
} from '../../../services/flight'

// Mission Planner's Actions area, cut down to the commands that actually get
// used in flight. The rarely-pressed ones are behind a single "Do action"
// picker rather than spread across a grid of buttons, which is the whole
// difference in clutter.
//
// Flight mode and arm/disarm are deliberately absent: they live in the app's
// action bar, where they are on screen in every mode and cannot scroll away.

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
    confirm: 'Onboard Lua scripts will stop and start again. Anything they were doing is interrupted.',
  },
  {
    id: 'reboot',
    label: 'Reboot autopilot',
    run: rebootAutopilot,
    confirm:
      'The autopilot reboots and the link drops. Never do this in the air — the vehicle will fall.',
  },
]

export default function FlightActionsBar() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const vehicleType = useVehicleStore((s) => s.vehicleType)
  const relAltM = useVehicleStore((s) => s.relAltM)
  const groundspeedMs = useVehicleStore((s) => s.groundspeedMs)
  const [status, setStatus] = useState('')
  const [speed, setSpeed] = useState('')
  const [alt, setAlt] = useState('')
  const [wp, setWp] = useState('')
  const [action, setAction] = useState(DO_ACTIONS[0]!.id)
  const [pending, setPending] = useState<DoAction | null>(null)

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

  const run = (a: DoAction) => {
    if (a.confirm) setPending(a)
    else void a.run().then(report(a.label)).catch(fail(a.label))
  }

  return (
    <div className="flight-actions">
      <div className="flight-actions__group">
        <LaButton variant="secondary" size="sm" disabled={!connected} onClick={() => jump('Auto')}>
          Auto
        </LaButton>
        <LaButton variant="secondary" size="sm" disabled={!connected} onClick={() => jump('RTL')}>
          RTL
        </LaButton>
      </div>

      <div className="flight-actions__group">
        <label className="la-field__label" htmlFor="fa-wp">
          Mission item
        </label>
        <input
          id="fa-wp"
          className="la-input la-input--num flight-actions__num"
          type="number"
          min={0}
          value={wp}
          placeholder="#"
          onChange={(e) => setWp(e.target.value)}
        />
        <LaButton
          variant="secondary"
          size="sm"
          disabled={!connected || wp === ''}
          onClick={() =>
            void setCurrentMissionItem(Number(wp)).then(report('Set item')).catch(fail('Set item'))
          }
        >
          Set
        </LaButton>
      </div>

      <div className="flight-actions__group">
        <label className="la-field__label" htmlFor="fa-speed">
          Speed <span className="la-field__unit">m/s</span>
        </label>
        <input
          id="fa-speed"
          className="la-input la-input--num flight-actions__num"
          type="number"
          min={0}
          value={speed}
          placeholder={groundspeedMs ? groundspeedMs.toFixed(0) : '—'}
          onChange={(e) => setSpeed(e.target.value)}
        />
        <LaButton
          variant="secondary"
          size="sm"
          disabled={!connected || speed === ''}
          onClick={() => void changeSpeed(Number(speed)).then(report('Speed')).catch(fail('Speed'))}
        >
          Set
        </LaButton>
      </div>

      <div className="flight-actions__group">
        <label className="la-field__label" htmlFor="fa-alt">
          Altitude <span className="la-field__unit">m rel</span>
        </label>
        <input
          id="fa-alt"
          className="la-input la-input--num flight-actions__num"
          type="number"
          min={0}
          value={alt}
          placeholder={relAltM ? relAltM.toFixed(0) : '—'}
          onChange={(e) => setAlt(e.target.value)}
        />
        <LaButton
          variant="secondary"
          size="sm"
          disabled={!connected || alt === ''}
          onClick={() => {
            setGuidedAltitude(Number(alt))
            setStatus('Altitude: sent')
          }}
        >
          Set
        </LaButton>
      </div>

      <div className="flight-actions__group flight-actions__group--do">
        <LaSelect
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
          Do action
        </LaButton>
      </div>

      {status && <LaHint>{status}</LaHint>}

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
    </div>
  )
}
