import { useEffect, useState, type CSSProperties } from 'react'
import { LaButton, LaCard, LaField, LaModal } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import WriteFeedback from '../../components/WriteFeedback'
import CardParamActions from '../../components/CardParamActions'
import FrameDiagram from '../configuration/FrameDiagram'
import { frameLayout } from '../../../protocol/frame-layout'
import { useConnectionStore } from '../../../stores/connection-store'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { timerGroups } from '../../../protocol/timer-groups'
import { useParamStore } from '../../../stores/param-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import { PWM_SCALE_MAX, PWM_SCALE_MIN, pwmPct } from '../../pwm-scale'
import { MAV_RESULT } from '../../../protocol/commands'
import { vehicleClass } from '../../../protocol/modes'

const MAV_CMD_DO_MOTOR_TEST = 209
const MAX_OUTPUTS = 16

/** A motor-test step as Mission Planner writes it: 1 is A, 2 is B. */
const letter = (step: number) => String.fromCharCode(64 + step)

/**
 * The test keys, halved into the two rows the card always draws, so the card
 * keeps one height up to ArduPilot's twelve motors. Every drawable frame has
 * an even number of test steps; an odd count puts the extra key first.
 */
export function splitKeypad(steps: readonly number[]): number[][] {
  const half = Math.ceil(steps.length / 2)
  return [steps.slice(0, half), steps.slice(half)]
}

// What each output drives, with the motor test beside it so an assignment can
// be verified immediately.
export default function OutputsTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  // Every card is drawn from parameters, so wait for the download to finish.
  if (!connected || !ready) {
    return <NeedsVehicle title="Outputs" />
  }
  return (
    // The output table, with the cards that act on it stacked in one column
    // beside it.
    <div className="outputs-screen">
      <OutputsCard />
      <div className="app-stack app-stack--fill">
        <MotorTestCard />
        <OutputOptionsCard />
        <MixingCard />
        <FlapsCard />
        {/* Written as they are set, like the table: these are tuned on the
          bench by spinning a motor and watching where it starts. */}
        <ParamCard
          title="Motor limits"
          showNames
          fields={[
            // Numeric rather than ArduPilot's suggested values, since the bench
            // result is rarely one of them.
            { param: 'MOT_SPIN_ARM', label: 'Spin when armed', writeNow: true, numeric: true },
            { param: 'MOT_SPIN_MIN', label: 'Spin minimum', writeNow: true, numeric: true },
            { param: 'MOT_SPIN_MAX', label: 'Spin maximum', writeNow: true, numeric: true },
            { param: 'MOT_PWM_MIN', label: 'PWM minimum', unit: 'µs', writeNow: true },
            { param: 'MOT_PWM_MAX', label: 'PWM maximum', unit: 'µs', writeNow: true },
            { param: 'MOT_THST_EXPO', label: 'Thrust expo', writeNow: true },
          ]}
        />
      </div>
    </div>
  )
}

function OutputsCard() {
  const entries = useParamStore((s) => s.entries)
  const outputs: number[] = []
  for (let n = 1; n <= MAX_OUTPUTS; n++) {
    if (entries.has(`SERVO${n}_FUNCTION`)) outputs.push(n)
  }
  return (
    <LaCard title="Servo outputs">
      <div className="app-table">
        <div className="app-table__row outputs-grid app-table__head">
          <span>Output</span>
          <span>Function</span>
          <span>Min</span>
          <span>Trim</span>
          <span>Max</span>
          <span>Position</span>
          <span>Reversed</span>
        </div>
        {outputs.map((n) => (
          <OutputRow key={n} n={n} />
        ))}
      </div>
    </LaCard>
  )
}

function OutputRow({ n }: { n: number }) {
  return (
    <div className="app-table__row outputs-grid">
      <span className="app-table__label">SERVO{n}</span>
      {/* Written as they are set, not staged: travel is found by adjusting a
          value and watching the servo. */}
      <ParamField param={`SERVO${n}_FUNCTION`} label="Function" bare writeNow />
      <ParamField param={`SERVO${n}_MIN`} label="Min" bare writeNow />
      <ParamField param={`SERVO${n}_TRIM`} label="Trim" bare writeNow />
      <ParamField param={`SERVO${n}_MAX`} label="Max" bare writeNow />
      {/* Beside the three numbers it is read against. */}
      <span className="servo-position-cell">
        <OutputPosition n={n} />
        <SetTrimButton n={n} />
      </span>
      <ReverseSwitch param={`SERVO${n}_REVERSED`} />
    </div>
  )
}

/**
 * What the output is driving now, from SERVO_OUTPUT_RAW: a bar with the pulse
 * width, like Mission Planner's Position column, on the Radio tab's scale.
 *
 * 0 means nothing on this output and draws as a dash. Motor outputs also read
 * 0 while the safety switch holds the outputs off.
 */
function OutputPosition({ n }: { n: number }) {
  const valueUs = useVehicleStore((s) => s.servoOutputsUs[n - 1]) ?? 0
  return (
    <div
      className="servo-position"
      role="meter"
      aria-label={`SERVO${n} output`}
      aria-valuemin={PWM_SCALE_MIN}
      aria-valuemax={PWM_SCALE_MAX}
      aria-valuenow={Math.max(PWM_SCALE_MIN, Math.min(PWM_SCALE_MAX, valueUs))}
      aria-valuetext={valueUs ? `${valueUs} microseconds` : 'no output'}
      title={valueUs ? `${valueUs} µs` : 'Nothing on this output'}
    >
      {valueUs > 0 && (
        <span className="servo-position__fill" style={{ width: `${pwmPct(valueUs)}%` }} />
      )}
      <span className="servo-position__value">{valueUs || '—'}</span>
    </div>
  )
}

/**
 * Make the output's current position its trim: hold the stick until the
 * surface sits right, press this, let go. Until the stick centers, its offset
 * rides on top of the new trim, so the surface moves further; that is expected.
 *
 * Written at once and staged on the way, as `ReverseSwitch` does, so a failed
 * write stays staged. The Trim field shows the result.
 *
 * Disabled with no reading, a reading outside Min/Max, or when the trim
 * already equals it; the hover text says which.
 */
function SetTrimButton({ n }: { n: number }) {
  const param = `SERVO${n}_TRIM`
  const valueUs = useVehicleStore((s) => s.servoOutputsUs[n - 1]) ?? 0
  const trim = useParamStore((s) => s.entries.get(param)?.value)
  const min = useParamStore((s) => s.entries.get(`SERVO${n}_MIN`)?.value)
  const max = useParamStore((s) => s.entries.get(`SERVO${n}_MAX`)?.value)
  const edit = useParamStore((s) => s.edit)

  const inTravel =
    valueUs > 0 && (min === undefined || valueUs >= min) && (max === undefined || valueUs <= max)
  const usable = trim !== undefined && inTravel && valueUs !== trim
  const why =
    trim === undefined
      ? `This vehicle has no ${param}`
      : valueUs === 0
        ? 'Nothing on this output'
        : !inTravel
          ? `${valueUs} is outside this output’s Min and Max`
          : `${param} is already ${valueUs}`

  const set = () => {
    edit(param, valueUs)
    void connectionService
      .setParamNow(param, valueUs)
      .then(() => useWriteFeedbackStore.getState().report({ ok: true, param }))
      .catch((err: unknown) => {
        useWriteFeedbackStore.getState().report({
          ok: false,
          param,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }

  return (
    <LaButton
      variant="ghost"
      size="sm"
      className="servo-position__set"
      disabled={!usable}
      aria-label={`Set ${param} to the current position`}
      title={usable ? `Set ${param} to ${valueUs}` : why}
      onClick={set}
    >
      Set trim
    </LaButton>
  )
}

/**
 * Reversed, written as it is flipped (a switch has no intermediate state).
 * A failed write falls back to staging, as `ParamField` does.
 */
function ReverseSwitch({ param }: { param: string }) {
  const entry = useParamStore((s) => s.entries.get(param))
  const edit = useParamStore((s) => s.edit)
  if (!entry) return <span className="la-muted outputs-grid__reverse">—</span>
  const commit = (on: boolean) => {
    const v = on ? 1 : 0
    edit(param, v)
    void connectionService
      .setParamNow(param, v)
      .then(() => useWriteFeedbackStore.getState().report({ ok: true, param }))
      .catch((err: unknown) => {
        useWriteFeedbackStore.getState().report({
          ok: false,
          param,
          ...(err instanceof Error && err.message ? { error: err.message } : {}),
        })
      })
  }
  return (
    <span className="param-control outputs-grid__reverse">
      <label className="la-switch">
        <input
          type="checkbox"
          checked={entry.value !== 0}
          onChange={(e) => commit(e.target.checked)}
        />
        <span className="la-switch__track"></span>
      </label>
      <WriteFeedback params={[param]} inline />
    </span>
  )
}

/**
 * How the control surfaces mix. Plane only; a multirotor reports neither
 * parameter, so the card hides itself. Neither is read at boot, so no restart
 * prompt is needed.
 */
function MixingCard() {
  return (
    <ParamCard
      title="Mixing"
      showNames
      fields={[
        { param: 'MIXING_GAIN', label: 'Mixing gain', writeNow: true },
        { param: 'KFF_RDDRMIX', label: 'Rudder mix', writeNow: true },
      ]}
    />
  )
}

/** When the flaps come out, and how fast. */
function FlapsCard() {
  return (
    <ParamCard
      title="Flaps"
      showNames
      fields={[
        // Units come from ArduPilot's metadata (%, m/s, %/s) rather than being
        // written here.
        { param: 'FLAP_1_PERCNT', label: 'Flaps 1 percent', writeNow: true },
        { param: 'FLAP_1_SPEED', label: 'Flaps 1 speed', writeNow: true },
        { param: 'FLAP_2_PERCNT', label: 'Flaps 2 percent', writeNow: true },
        { param: 'FLAP_2_SPEED', label: 'Flaps 2 speed', writeNow: true },
        { param: 'TKOFF_FLAP_PCNT', label: 'Takeoff flaps', writeNow: true },
        { param: 'LAND_FLAP_PERCNT', label: 'Landing flaps', writeNow: true },
        { param: 'FLAP_SLEWRATE', label: 'Slew rate', writeNow: true },
      ]}
    />
  )
}

/**
 * What protocol the outputs speak, and which outputs share a timer (and so a
 * protocol) on this board.
 *
 * The protocol parameter differs by vehicle:
 *   - a multirotor has `MOT_PWM_TYPE`, which drives every motor output;
 *   - a quadplane has `Q_M_PWM_TYPE` for its lift motors and
 *     `SERVO_BLH_OTYPE` for the forward one;
 *   - a fixed wing has only `SERVO_BLH_OTYPE`, applied to the channels in
 *     `SERVO_BLH_MASK`. On a plane nothing fills that mask automatically
 *     (on Copter `SERVO_BLH_AUTO` adds the motors), so it is on the card.
 *
 * On a plane both rows are always drawn, disabled where the firmware lacks
 * them. They come from AP_BLHeli, which every ChibiOS board builds
 * (`HAL_SUPPORT_RCOUT_SERIAL`) but SITL only gained in master abc8df0d, so
 * 4.7 simulators report neither.
 *
 * Settings that only refine a protocol (DShot rate and ESC type, the
 * pass-through settings) are in the ESC settings dialog.
 */
function OutputOptionsCard() {
  const boardName = useVehicleStore((s) => s.boardName)
  const boardId = useVehicleStore((s) => s.boardId)
  const entries = useParamStore((s) => s.entries)
  const [escOpen, setEscOpen] = useState(false)
  // Fixed wing and quadplane both report a plane MAV_TYPE and both choose a
  // forward motor's protocol with SERVO_BLH_OTYPE.
  const plane = useVehicleStore((s) => vehicleClass(s.vehicleType) === 'plane')

  // The protocol selectors this vehicle has. On Copter `SERVO_BLH_OTYPE` is
  // only an override for outputs outside the motor group, so it stays in the
  // dialog.
  const hasVtol = entries.has('Q_M_PWM_TYPE')
  const protocols = [
    { param: 'MOT_PWM_TYPE', label: 'Motor output' },
    { param: 'Q_M_PWM_TYPE', label: 'VTOL motor output' },
    { param: 'SERVO_BLH_OTYPE', label: hasVtol ? 'Forward motor output' : 'Motor output' },
  ].filter((f) => (f.param === 'SERVO_BLH_OTYPE' ? plane : entries.has(f.param)))
  const maskOnCard = plane || entries.has('SERVO_BLH_MASK')

  // The dialog holds what refines a protocol and is not on the card. It is
  // offered only when the firmware has a protocol selector.
  const onCard = new Set([
    ...protocols.map((f) => f.param),
    ...(maskOnCard ? ['SERVO_BLH_MASK'] : []),
  ])
  // SERVO_BLH_AUTO adds the AP_Motors group, which ArduPlane only creates
  // with Q_ENABLE on, so it is left out on a fixed wing. An unreported
  // Q_ENABLE keeps it.
  const fixedWing = plane && entries.get('Q_ENABLE')?.value === 0
  const escParams = ESC_SETTINGS.filter(
    (p) => entries.has(p) && !onCard.has(p) && !(fixedWing && p === 'SERVO_BLH_AUTO'),
  )
  const escAvailable = escParams.length > 0 && protocols.some((f) => entries.has(f.param))

  return (
    <LaCard
      title="Output options"
      className="outproto"
      actions={
        // Staged, unlike the rest of this screen: a protocol is chosen once,
        // several of these apply only after a restart, and a half-made change
        // would briefly drive the ESCs in an unintended way. Owns only what is
        // on the card; the dialog has its own Write.
        <CardParamActions
          reason="Output changes take effect after a restart"
          owns={(param) => onCard.has(param)}
        />
      }
    >
      <ParamField param="SERVO_RATE" label="Servo rate" showName />
      {protocols.map((f) => {
        const present = entries.has(f.param)
        return (
          <div
            className={present ? 'outproto__protocol' : 'outproto__protocol la-field--off'}
            key={f.param}
          >
            <label className="la-field__label">{f.label}</label>
            <span className="la-field__param">{f.param}</span>
            <ParamField
              param={f.param}
              label={f.label}
              bare
              {...(present ? {} : { disabled: true })}
            />
            <span />
          </div>
        )
      })}
      {maskOnCard && (
        <ParamField
          param="SERVO_BLH_MASK"
          label="Protocol outputs"
          showName
          {...(entries.has('SERVO_BLH_MASK') ? {} : { disabled: true })}
        />
      )}
      {/* A row of its own under the selectors it qualifies, with the button
          in the control column. */}
      {escAvailable && (
        <div className="outproto__protocol">
          <label className="la-field__label">ESC settings</label>
          <span />
          <LaButton variant="secondary" onClick={() => setEscOpen(true)}>
            Configure
          </LaButton>
          <span />
        </div>
      )}
      <TimerGroupBubbles name={boardName} id={boardId} />
      {escOpen && <EscSettingsModal params={escParams} onClose={() => setEscOpen(false)} />}
    </LaCard>
  )
}

/** The pass-through library's parameters. */
const ESC_PARAMS = [
  'SERVO_BLH_AUTO',
  'SERVO_BLH_MASK',
  'SERVO_BLH_BDMASK',
  'SERVO_BLH_RVMASK',
  'SERVO_BLH_3DMASK',
  'SERVO_BLH_POLES',
  'SERVO_BLH_TRATE',
  'SERVO_BLH_OTYPE',
  'SERVO_BLH_PORT',
]

/**
 * Everything the ESC settings dialog can hold, in the order it shows them:
 * DShot's two refinements first, then the pass-through library's. The card
 * passes in the ones this vehicle has and does not already show.
 */
const ESC_SETTINGS = ['SERVO_DSHOT_RATE', 'SERVO_DSHOT_ESC', ...ESC_PARAMS]

/**
 * Settings that refine the output protocol, rarely changed after ESC setup.
 * The pass-through settings enable ArduPilot's ESC pass-through, which exposes
 * the ESCs' 4-way interface on a MAVLink serial channel for BLHeliSuite or
 * the AM32 configurator.
 */
function EscSettingsModal({ params, onClose }: { params: string[]; onClose: () => void }) {
  const owns = (param: string) => params.includes(param)
  const pending = useParamStore((s) => {
    let n = 0
    for (const param of params) if (s.entries.get(param)?.dirty) n++
    return n
  })
  const writeBusy = useParamStore((s) => s.writeBusy)
  return (
    <LaModal
      open
      title="ESC settings"
      actions={
        // Its own Revert and Write. Close is hidden while anything here is
        // unwritten, so no staged edit is left without a visible Write.
        <>
          <CardParamActions reason="ESC changes take effect after a restart" owns={owns} />
          {pending === 0 && !writeBusy && (
            <LaButton variant="primary" onClick={onClose}>
              Close
            </LaButton>
          )}
        </>
      }
    >
      <div className="esc-settings dialog-fields">
        {params.map((param) => (
          <ParamField key={param} param={param} label={ESC_LABELS[param] ?? param} showName />
        ))}
      </div>
    </LaModal>
  )
}

const ESC_LABELS: Record<string, string> = {
  SERVO_DSHOT_RATE: 'DShot rate',
  SERVO_DSHOT_ESC: 'DShot ESC type',
  SERVO_BLH_AUTO: 'Auto-enable',
  SERVO_BLH_MASK: 'Pass-through outputs',
  SERVO_BLH_BDMASK: 'Bi-directional DShot',
  SERVO_BLH_RVMASK: 'Reversed outputs',
  SERVO_BLH_3DMASK: '3D outputs',
  SERVO_BLH_POLES: 'Motor poles',
  SERVO_BLH_TRATE: 'Telemetry rate',
  SERVO_BLH_OTYPE: 'Output type override',
  SERVO_BLH_PORT: 'Pass-thru port',
}

/**
 * Which outputs share a hardware timer, and so must share a protocol
 * (choosing DShot on output 5 can take 6-8 with it). Drawn as bubbles, not
 * controls, since this is fixed by the board's wiring.
 *
 * Always one row high so the card's height does not change; a dash when the
 * board is not in the table.
 */
function TimerGroupBubbles({ name, id }: { name: string | null; id: number }) {
  const board = timerGroups(name, id)
  const full = board
    ? board.groups
        .map(
          ([low, high, timer, nodma]) =>
            `${timer} ${low === high ? low : `${low}-${high}`}${nodma ? ' (no DMA)' : ''}`,
        )
        .join(', ')
    : undefined

  return (
    <div className="outproto__groups-row">
      <label className="la-field__label">Timer groups</label>
      {/* Starts in the name column, since the groups do not fit the control
          column. Timer names are in the hover text; only the grouping
          matters for choosing a protocol. */}
      <div className="outproto__bubbles" title={full}>
        {board ? (
          board.groups.map(([low, high, timer, nodma]) => (
            <span
              className={nodma ? 'outproto__bubble outproto__bubble--nodma' : 'outproto__bubble'}
              key={`${timer}-${low}`}
            >
              <span className="outproto__chans">{low === high ? low : `${low}-${high}`}</span>
            </span>
          ))
        ) : (
          <span className="outproto__bubble outproto__bubble--none">—</span>
        )}
      </div>
    </div>
  )
}

/** How long a motor-test result stays on the title row, as Set level's does. */
const MOTOR_STATUS_MS = 4000

function MotorTestCard() {
  // Nothing spins until the user confirms the props are off, once per session.
  const [interlocked, setInterlocked] = useState(false)
  // ArduPlane's motor test exists only for quadplanes:
  // `QuadPlane::mavlink_motor_test_start` answers FAILED when Q_ENABLE is 0.
  // Only a vehicle that reports Q_ENABLE = 0 is excluded; Copter and Rover
  // have motor tests of their own.
  const qEnable = useParamStore((s) => s.entries.get('Q_ENABLE')?.value)
  const frameClass = useParamStore(
    (s) => s.entries.get('FRAME_CLASS')?.value ?? s.entries.get('Q_FRAME_CLASS')?.value,
  )
  const frameType = useParamStore(
    (s) => s.entries.get('FRAME_TYPE')?.value ?? s.entries.get('Q_FRAME_TYPE')?.value,
  )
  const [confirming, setConfirming] = useState(false)
  const [throttle, setThrottle] = useState(10)
  const [duration, setDuration] = useState(2)
  // A result fades after a few seconds; a spin stays up while the motor
  // turns; the in-progress line holds until a result replaces it.
  const [status, setStatus] = useState<{ text: string; holdMs: number } | null>(null)
  useEffect(() => {
    if (!status || !Number.isFinite(status.holdMs)) return
    const t = setTimeout(() => setStatus(null), status.holdMs)
    return () => clearTimeout(t)
  }, [status])

  const test = async (motor: number) => {
    setStatus({ text: `Motor ${letter(motor)}…`, holdMs: Infinity })
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
          ? {
              text: `Motor ${letter(motor)}: spinning ${throttle}% for ${duration}s`,
              holdMs: Math.max(MOTOR_STATUS_MS, duration * 1000),
            }
          : {
              text: `Motor ${letter(motor)}: ${MAV_RESULT[result] ?? `result ${result}`}`,
              holdMs: MOTOR_STATUS_MS,
            },
      )
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : 'The vehicle did not answer.',
        holdMs: MOTOR_STATUS_MS,
      })
    }
  }

  if (qEnable === 0) return null

  // No drawing for a frame class with no picture; the test still works.
  const motors = frameClass === undefined ? null : frameLayout(frameClass, frameType ?? 0)

  // One button per step of this frame's test sequence (a tricopter's tail
  // servo included), or Mission Planner's eight for an unknown frame.
  const slots = motors ? motors.map((m) => m.test).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7, 8]

  const keyRows = splitKeypad(slots)

  /** What a test step actually reaches, for the button's hover. */
  const motorFor = (step: number) => {
    const m = motors?.find((x) => x.test === step)
    if (!m) return `Test step ${step}`
    return m.servo ? `Tail servo on channel ${m.n}` : `Motor ${m.n}`
  }

  /** DO_MOTOR_TEST at 0% for 0 s: ends whatever test is running, starts none. */
  const sendStop = () => {
    for (let m = 1; m <= 8; m++) {
      void connectionService
        .runCommand(MAV_CMD_DO_MOTOR_TEST, [m, 0, 0, 0, 0, 0, 0], 2000)
        .catch(() => {})
    }
  }
  const stopAll = () => {
    sendStop()
    setStatus({ text: 'Stop sent to all motors.', holdMs: MOTOR_STATUS_MS })
  }
  // Disabling sends a stop first, since Stop all disappears with it.
  const disable = () => {
    sendStop()
    setStatus(null)
    setInterlocked(false)
  }

  return (
    // The interlock and the result sit on the title row so the card never
    // changes height; the props-off question is in the Enable confirmation.
    <LaCard
      className="motor-test"
      title="Motor test"
      actions={
        <>
          {status && (
            <span className="card-status" role="status" title={status.text}>
              {status.text}
            </span>
          )}
          {/* Only while enabled; Disable sends the same stop. Red because
              destructive controls are the exception to status-only color. */}
          {interlocked && (
            <LaButton variant="danger" onClick={stopAll}>
              Stop all
            </LaButton>
          )}
          {/* One switch for the whole card, on the title row in both states. */}
          {interlocked ? (
            <LaButton variant="ghost" onClick={disable}>
              Disable
            </LaButton>
          ) : (
            <LaButton variant="secondary" onClick={() => setConfirming(true)}>
              Enable motor test
            </LaButton>
          )}
        </>
      }
    >
      {/* The frame drawing sits beside the controls, using the column's
          full height. */}
      <div className="motor-test__body">
        {/* Always rendered, disabled until enabled, so the card keeps its height. */}
        <fieldset className="motor-test__controls" disabled={!interlocked}>
          <div className="motor-test__levels">
            <LaField label="Throttle" unit="%" htmlFor="mt-throttle">
              <input
                id="mt-throttle"
                className="la-input la-input--num"
                type="number"
                min={0}
                max={100}
                value={throttle}
                onChange={(e) =>
                  setThrottle(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
                }
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
                onChange={(e) =>
                  setDuration(Math.min(10, Math.max(0.5, Number(e.target.value) || 2)))
                }
              />
            </LaField>
          </div>
          {/* Equal-width keys, lettered like Mission Planner's because they are
              positions in the test sequence, not motor numbers (on a quad X,
              test B is motor 4). The drawing uses the same letters; the hover
              and accessible name say which motor each reaches. */}
          <p className="la-card__subtitle motor-test__what">Spin motors</p>
          <div className="motor-test__keypad">
            {keyRows.map((row, i) => (
              <div
                className="motor-test__row"
                key={i}
                // The row's key count, so CSS can cap its width at that many keys.
                style={{ '--keys': row.length || 1 } as CSSProperties}
              >
                {row.map((m) => (
                  <LaButton
                    key={m}
                    variant="secondary"
                    title={`Test ${letter(m)} — ${motorFor(m)}`}
                    aria-label={`Test ${letter(m)}, ${motorFor(m)}`}
                    onClick={() => void test(m)}
                  >
                    {letter(m)}
                  </LaButton>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        {motors && <FrameDiagram motors={motors} className="motor-test__art" labels="test" />}
      </div>
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
