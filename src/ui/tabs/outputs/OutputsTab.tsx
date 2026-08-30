import { useState } from 'react'
import { LaButton, LaCard, LaField, LaHint, LaModal } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useProfileLabels } from '../../../stores/guide-store'
import { connectionService } from '../../../services/connection'
import { MAV_RESULT } from '../../../protocol/commands'

const MAV_CMD_DO_MOTOR_TEST = 209
const MAX_OUTPUTS = 16

// What each output drives, and the means to prove it. Assignment and motor
// test sit together deliberately: you set a function and immediately verify
// the right thing moved.
export default function OutputsTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  if (!connected) {
    return (
      <NeedsVehicle
        title="Outputs"
        body="Servo and motor output assignments, endpoints, and the motor test."
      />
    )
  }
  return (
    <>
      <OutputsCard />
      <MotorTestCard />
      <ParamCard
        title="Motor limits"
        note="Spin values are a fraction of the throttle range; too low and motors stall on arming, too high and the vehicle creeps."
        fields={[
          { param: 'MOT_SPIN_ARM', label: 'Spin when armed' },
          { param: 'MOT_SPIN_MIN', label: 'Spin minimum' },
          { param: 'MOT_SPIN_MAX', label: 'Spin maximum' },
          { param: 'MOT_PWM_TYPE', label: 'PWM type' },
          { param: 'MOT_PWM_MIN', label: 'PWM minimum', unit: 'µs' },
          { param: 'MOT_PWM_MAX', label: 'PWM maximum', unit: 'µs' },
          { param: 'MOT_THST_EXPO', label: 'Thrust expo' },
        ]}
      />
    </>
  )
}

function OutputsCard() {
  const ready = useParamStore((s) => s.loadState === 'ready')
  const entries = useParamStore((s) => s.entries)
  if (!ready) {
    return (
      <LaCard title="Servo outputs">
        <p className="app-placeholder">Waiting for parameters…</p>
      </LaCard>
    )
  }
  const outputs: number[] = []
  for (let n = 1; n <= MAX_OUTPUTS; n++) {
    if (entries.has(`SERVO${n}_FUNCTION`)) outputs.push(n)
  }
  return (
    <LaCard
      title="Servo outputs"
      note="Function assigns what each output drives; min/trim/max are the µs endpoints. Stage edits here and send them with Write Params."
    >
      <div className="outputs-grid outputs-grid--head">
        <span>Output</span>
        <span>Function</span>
        <span>Min</span>
        <span>Trim</span>
        <span>Max</span>
        <span>Reversed</span>
      </div>
      {outputs.map((n) => (
        <OutputRow key={n} n={n} />
      ))}
    </LaCard>
  )
}

function OutputRow({ n }: { n: number }) {
  // Product profiles (opt-in, Overview > Guided setups) name the outputs for
  // their airframe; without one this is just SERVOn.
  const { outputLabels } = useProfileLabels()
  const label = outputLabels[n]
  return (
    <div className="outputs-grid">
      <span className="outputs-grid__label" title={label ? `SERVO${n}` : undefined}>
        SERVO{n}
        {label && <span className="outputs-grid__product">{label}</span>}
      </span>
      <ParamField param={`SERVO${n}_FUNCTION`} label="Function" bare />
      <ParamField param={`SERVO${n}_MIN`} label="Min" bare />
      <ParamField param={`SERVO${n}_TRIM`} label="Trim" bare />
      <ParamField param={`SERVO${n}_MAX`} label="Max" bare />
      <ReverseSwitch param={`SERVO${n}_REVERSED`} />
    </div>
  )
}

function ReverseSwitch({ param }: { param: string }) {
  const entry = useParamStore((s) => s.entries.get(param))
  const edit = useParamStore((s) => s.edit)
  if (!entry) return <span className="la-muted">—</span>
  return (
    <label className="la-switch">
      <input
        type="checkbox"
        checked={entry.value !== 0}
        onChange={(e) => edit(param, e.target.checked ? 1 : 0)}
      />
      <span className="la-switch__track"></span>
    </label>
  )
}

function MotorTestCard() {
  // The interlock is deliberate friction: nothing in this card spins until
  // the user has affirmed the props are off, once per session.
  const [interlocked, setInterlocked] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [throttle, setThrottle] = useState(10)
  const [duration, setDuration] = useState(2)
  const [status, setStatus] = useState('')

  const test = async (motor: number) => {
    setStatus(`Motor ${motor}…`)
    try {
      // param1 motor (1-based), param2 type 0=percent, param3 value,
      // param4 timeout s.
      const result = await connectionService.runCommand(
        MAV_CMD_DO_MOTOR_TEST,
        [motor, 0, throttle, duration, 0, 0, 0],
        5000,
      )
      setStatus(
        result === 0
          ? `Motor ${motor}: spinning ${throttle}% for ${duration}s`
          : `Motor ${motor}: ${MAV_RESULT[result] ?? result}`,
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'no answer')
    }
  }

  const stopAll = async () => {
    for (let m = 1; m <= 8; m++) {
      void connectionService
        .runCommand(MAV_CMD_DO_MOTOR_TEST, [m, 0, 0, 0, 0, 0, 0], 2000)
        .catch(() => {})
    }
    setStatus('Stop sent to all motors.')
  }

  return (
    <LaCard
      title="Motor test"
      subtitle="Props off"
      note="Motor numbers are ArduPilot output numbers, not frame positions — check each against the frame diagram for your airframe."
    >
      {!interlocked ? (
        <div className="la-row">
          <LaButton variant="secondary" onClick={() => setConfirming(true)}>
            Enable motor test…
          </LaButton>
        </div>
      ) : (
        <>
          <LaField label="Throttle" unit="%" htmlFor="mt-throttle">
            <input
              id="mt-throttle"
              className="la-input la-input--num"
              type="number"
              min={0}
              max={100}
              value={throttle}
              onChange={(e) => setThrottle(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
            />
          </LaField>
          <LaField label="Duration" unit="s" htmlFor="mt-duration">
            <input
              id="mt-duration"
              className="la-input la-input--num"
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(Math.min(10, Math.max(0.5, Number(e.target.value) || 2)))}
            />
          </LaField>
          <div className="la-row la-row--wrap">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((m) => (
              <LaButton key={m} variant="secondary" onClick={() => void test(m)}>
                Motor {m}
              </LaButton>
            ))}
          </div>
          <div className="la-row">
            <LaButton variant="danger" onClick={() => void stopAll()}>
              Stop all
            </LaButton>
          </div>
        </>
      )}
      <LaHint>{status}</LaHint>
      {confirming && (
        <LaModal
          open
          title="Propellers removed?"
          actions={
            <>
              <LaButton variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </LaButton>
              <LaButton
                variant="danger"
                onClick={() => {
                  setInterlocked(true)
                  setConfirming(false)
                }}
              >
                Props are off — enable
              </LaButton>
            </>
          }
        >
          <p>
            Motor test spins real motors. Confirm every propeller is physically removed from the
            vehicle before enabling.
          </p>
        </LaModal>
      )}
    </LaCard>
  )
}
