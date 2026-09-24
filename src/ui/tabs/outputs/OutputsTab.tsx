import { useState, type CSSProperties } from 'react'
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
import { useProfileLabels } from '../../../stores/guide-store'
import { useWriteFeedbackStore } from '../../../stores/write-feedback-store'
import { connectionService } from '../../../services/connection'
import { PWM_SCALE_MAX, PWM_SCALE_MIN, pwmPct } from '../../pwm-scale'
import { MAV_RESULT } from '../../../protocol/commands'

const MAV_CMD_DO_MOTOR_TEST = 209
const MAX_OUTPUTS = 16

/** A motor-test step as Mission Planner writes it: 1 is A, 2 is B. */
const letter = (step: number) => String.fromCharCode(64 + step)

/**
 * The test keys, halved into the two rows the card always draws.
 *
 * Two rows because the card must not change height -- ArduPilot tests up to
 * twelve motors and a third row would push everything under it down -- and
 * halved rather than filled left to right because every frame it can draw has
 * an even number of test steps, so both rows come out the same length and the
 * keypad is a rectangle at every frame. An odd count puts the extra key first.
 */
export function splitKeypad(steps: readonly number[]): number[][] {
  const half = Math.ceil(steps.length / 2)
  return [steps.slice(0, half), steps.slice(half)]
}

// What each output drives, and the means to prove it. Assignment and motor
// test sit together deliberately: you set a function and immediately verify
// the right thing moved.
export default function OutputsTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const ready = useParamStore((s) => s.loadState === 'ready')
  // Parameters as well as a link. Every card here is drawn from them -- which
  // outputs exist, whether the vehicle has VTOL motors, what protocol they
  // speak -- so while they are arriving the screen would otherwise show a
  // placeholder card *beside* two cards drawn from a half-empty set. One
  // answer, not three. The download's progress is on the app bar, which is
  // where it belongs: it is not about the screen you happen to be on.
  if (!connected || !ready) {
    return (
      <NeedsVehicle title="Outputs" />
    )
  }
  return (
    // The table is the page; the two cards beside it are what you do *to* what
    // it says -- spin a motor, then set where it starts spinning -- so they
    // stack in one column rather than wrapping into the grid wherever they
    // fit. `start`, not stretch: sixteen rows of outputs is taller than
    // anything that belongs beside it, and padding two short cards out to
    // match would put a band of white under each.
    <div className="outputs-screen">
      <OutputsCard />
      <div className="app-stack app-stack--fill">
        <MotorTestCard />
        <OutputOptionsCard />
        <MixingCard />
        <FlapsCard />
      {/* Written as they are set, like the table above: these are the other
          half of the same bench loop -- spin up a motor, watch where it
          starts, nudge the minimum -- and a page that auto-saves one card and
          stages the other would be two behaviours on one screen. MOT_PWM_TYPE
          is read at boot, and the field raises the restart prompt itself from
          ArduPilot's own metadata. */}
      <ParamCard
        title="Motor limits"
        showNames
        fields={[
          // Numbers, not the three names ArduPilot suggests: these are found on
          // the bench by spinning a motor and watching where it starts, and the
          // value that comes out of that is rarely one of the three.
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
    // The column headings say what each field is; a note repeating them in a
    // sentence is the same information twice.
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
  // Product profiles (opt-in, Overview > Guided setups) name the outputs for
  // their airframe; without one this is just SERVOn.
  const { outputLabels } = useProfileLabels()
  const label = outputLabels[n]
  return (
    <div className="app-table__row outputs-grid">
      <span className="app-table__label" title={label ? `SERVO${n}` : undefined}>
        SERVO{n}
        {label && <span className="outputs-grid__product">{label}</span>}
      </span>
      {/* Written as they are set, not staged. Travel is found by moving a
          surface and watching it: type a Min, look at the servo, adjust. With
          staging that loop needs a trip to a Write button between every
          attempt, and the value on screen is not the one the servo is
          obeying -- which is the whole question being asked. */}
      <ParamField param={`SERVO${n}_FUNCTION`} label="Function" bare writeNow />
      <ParamField param={`SERVO${n}_MIN`} label="Min" bare writeNow />
      <ParamField param={`SERVO${n}_TRIM`} label="Trim" bare writeNow />
      <ParamField param={`SERVO${n}_MAX`} label="Max" bare writeNow />
      {/* Beside the three numbers it is read against: set a Max, watch the
          bar reach it. */}
      <span className="servo-position-cell">
        <OutputPosition n={n} />
        <SetTrimButton n={n} />
      </span>
      <ReverseSwitch param={`SERVO${n}_REVERSED`} />
    </div>
  )
}

/**
 * What the output is driving right now, from SERVO_OUTPUT_RAW: a bar with the
 * pulse width on it, Mission Planner's Position column.
 *
 * Drawn, not an input. It sits in a row of boxes that take a value, and a box
 * the same shape that takes none is a control that does nothing when clicked.
 * The bar is on the Radio tab's scale, so a stick and the servo it moves read
 * at the same place.
 *
 * 0 is ArduPilot's "nothing on this output" and draws as a dash, not as a
 * pulse of zero. It is also what a motor output reads while the safety switch
 * is holding the outputs off, so four dashes on a copter's motors is not a
 * lost reading.
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
 * Make where the output is now its trim.
 *
 * The way a surface is trimmed on the bench: hold the stick until the surface
 * sits where it should, press this, let go. The trim becomes the held position,
 * so the surface returns there when the stick centers -- and until it does, the
 * stick's offset rides on top of the new trim, which is the surface moving
 * further while the stick is still held, not a fault.
 *
 * Written at once, like everything else in the row, and answered by the Trim
 * field's own mark rather than one of its own: the value that changed is in
 * that box, so that is where the tick belongs. It stages on the way past, as
 * `ReverseSwitch` does, so a write that does not land leaves the value for the
 * footer's Write instead of losing it.
 *
 * Disabled with nothing to take -- no reading, or one outside this output's
 * Min and Max, which a trim may not be -- and when the trim is already there,
 * which is its state with the sticks at rest. The hover text says which.
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
 * Reversed, written as it is flipped.
 *
 * A switch is its own commit gesture -- there is no half-flipped state and
 * nothing to type through -- so it sends on change, like a dropdown. It
 * carries the same mark as the fields beside it, and falls back to staging on
 * a failure exactly as `ParamField` does: the value the user chose is still
 * what they want, and the footer's Write is then the honest state of it.
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
 * What each output speaks, and -- where the board says so -- which outputs it
 * has no choice about.
 *
 * Separate from the servo table because it is one setting for the whole board
 * rather than one per row: a flight controller's outputs are wired to hardware
 * timers in groups, and every channel in a group shares a protocol. Choosing
 * DShot on output 5 takes 6, 7 and 8 with it, and no parameter says so --
 * which is what the RCOut line at the top of this card is for.
 *
 * `MOT_PWM_TYPE` moved here from Motor limits. It is the same question as the
 * rest of this card (what protocol comes out) rather than a limit, and a
 * screen that asked it in two places would be two answers.
 *
 * The BLHeli rows are absent on SITL and present on hardware, so `ParamCard`
 * decides whether they appear -- these settings *enable* ArduPilot's
 * pass-through, which puts the ESCs' own 4-way interface on a MAVLink serial
 * channel for BLHeliSuite or the AM32 configurator to reach. Being that
 * configurator is a different feature and a much larger one.
 */
/**
 * What the control surfaces do with each other.
 *
 * Plane's alone -- a multirotor reports neither, so the card hides itself
 * without a vehicle test. These decide what a servo actually does once its
 * function is chosen in the table beside it.
 *
 * Ungated on purpose: both are inert on an aircraft with no elevons and no
 * rudder, so hiding them would cost more than it saves. Neither is read at
 * boot, so this card needs no restart prompt -- checked against ArduPlane's own
 * metadata rather than assumed.
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

/**
 * When the flaps come out, and how fast.
 *
 * Its own card rather than the tail of the mixing one: a mix is a permanent
 * relationship between two surfaces, where this is a schedule the aircraft
 * follows in flight, and the two were only together because they are both
 * Plane's.
 */
function FlapsCard() {
  return (
    <ParamCard
      title="Flaps"
      showNames
      fields={[
        // Units come from ArduPilot's metadata (%, m/s, %/s) rather than being
        // written here.
        { param: 'FLAP_1_PERCNT', label: 'Flap 1', writeNow: true },
        { param: 'FLAP_1_SPEED', label: 'Flap 1 speed', writeNow: true },
        { param: 'FLAP_2_PERCNT', label: 'Flap 2', writeNow: true },
        { param: 'FLAP_2_SPEED', label: 'Flap 2 speed', writeNow: true },
        { param: 'FLAP_SLEWRATE', label: 'Slew rate', writeNow: true },
        { param: 'TKOFF_FLAP_PCNT', label: 'Takeoff flap', writeNow: true },
        { param: 'LAND_FLAP_PERCNT', label: 'Landing flap', writeNow: true },
      ]}
    />
  )
}

/** The output protocols that are DShot, from AP_Motors' shared pwm_type enum. */
const DSHOT_VALUES = new Set([4, 5, 6, 7])

/**
 * What the outputs speak, and what the board will let them.
 *
 * The protocol parameter is not the same on every vehicle, and the difference
 * is not cosmetic:
 *
 *   - a multirotor has `MOT_PWM_TYPE`, which drives every motor output;
 *   - a quadplane has `Q_M_PWM_TYPE` for its lift motors **and**
 *     `SERVO_BLH_OTYPE` for the forward one;
 *   - a fixed wing has only `SERVO_BLH_OTYPE`, which ArduPilot's own comment
 *     introduces as the way "to use DShot for rovers and subs, plus for
 *     quadplane fwd motors". It applies to the channels in `SERVO_BLH_MASK`,
 *     which is why that mask is on the card rather than buried in the dialog:
 *     on a plane nothing fills it in, where on a Copter `SERVO_BLH_AUTO` adds
 *     the motors for you.
 */
function OutputOptionsCard() {
  const boardName = useVehicleStore((s) => s.boardName)
  const boardId = useVehicleStore((s) => s.boardId)
  const entries = useParamStore((s) => s.entries)
  const [escOpen, setEscOpen] = useState(false)
  // The pass-through settings exist only where the firmware compiled them in,
  // which is every ChibiOS board and no SITL. Asking the vehicle rather than
  // the board type, because that is what actually decides it.
  const hasEsc = ESC_PARAMS.some((p) => entries.has(p))

  // Whichever protocol selectors this vehicle has, in the order they matter.
  // `SERVO_BLH_OTYPE` is the forward motor only where there are lift motors to
  // tell it apart from; on a plain fixed wing it is *the* motor.
  const hasVtol = entries.has('Q_M_PWM_TYPE')
  const protocols = [
    { param: 'MOT_PWM_TYPE', label: 'Motor output' },
    { param: 'Q_M_PWM_TYPE', label: 'VTOL motor output' },
    { param: 'SERVO_BLH_OTYPE', label: hasVtol ? 'Forward motor output' : 'Motor output' },
  ].filter((f) => entries.has(f.param))

  // DShot has settings of its own and nothing else does, so they are drawn only
  // when something is actually set to it -- two extra rows on a card that
  // otherwise has three, for a protocol most aircraft do not use.
  //
  // ...unless there is no selector to consult. `SERVO_DSHOT_*` live in
  // SRV_Channels and exist on every vehicle, but the thing that *chooses*
  // DShot does not: a fixed wing picks it with SERVO_BLH_OTYPE, which is
  // absent wherever AP_BLHeli was not compiled in -- SITL among them. Hiding
  // the settings then removes the only way to reach a parameter the firmware
  // is still using, so with nothing to gate on they are shown.
  const dshot =
    protocols.length === 0 ||
    protocols.some((f) => DSHOT_VALUES.has(entries.get(f.param)?.value ?? -1))

  return (
    <LaCard
      title="Output options"
      className="outproto"
      actions={
        // Staged rather than written as they are chosen, unlike the rest of
        // this screen. Travel and motor limits are found by nudging a value and
        // watching the aircraft, which is what auto-save is for; a protocol is
        // not -- it is chosen once, several of these only take effect after a
        // restart, and switching one mid-thought would have the vehicle briefly
        // driving its ESCs a way nobody meant. `CardParamActions` carries the
        // restart prompt itself, so this card no longer mounts its own.
        <CardParamActions
          reason="Output changes take effect after a restart"
          owns={(param) => OUTPUT_OPTION_PARAMS.has(param)}
        />
      }
    >
      <ParamField param="SERVO_RATE" label="Servo rate" unit="Hz" showName />
      {protocols.map((f, i) => (
        // The ESC dialog opens from the last protocol row rather than from the
        // title: what is in it qualifies *these* selectors, and a button in the
        // corner of the card read as belonging to the card as a whole.
        <div
          className={
            i === protocols.length - 1 && hasEsc
              ? 'outproto__protocol outproto__protocol--btn'
              : 'outproto__protocol'
          }
          key={f.param}
        >
          <label className="la-field__label">{f.label}</label>
          <span className="la-field__param">{f.param}</span>
          <ParamField param={f.param} label={f.label} bare />
          <span />
          {i === protocols.length - 1 && hasEsc && (
            <LaButton variant="secondary" onClick={() => setEscOpen(true)}>
              ESC settings…
            </LaButton>
          )}
        </div>
      ))}
      {hasEsc && (
        <ParamField param="SERVO_BLH_MASK" label="Protocol outputs" showName />
      )}
      {dshot && <ParamField param="SERVO_DSHOT_RATE" label="DShot rate" showName />}
      {dshot && <ParamField param="SERVO_DSHOT_ESC" label="DShot ESC type" showName />}
      <TimerGroupBubbles name={boardName} id={boardId} />
      {escOpen && <EscSettingsModal onClose={() => setEscOpen(false)} />}
    </LaCard>
  )
}

/**
 * Everything this card's Write is responsible for, the dialog's included.
 *
 * The dialog is opened from the card and belongs to it, so its nine parameters
 * stage into the same count rather than writing behind a modal -- one card, one
 * Write. Leaving the page with them unsent is caught by the usual prompt.
 */
const OUTPUT_OPTION_PARAMS: ReadonlySet<string> = new Set([
  'SERVO_RATE',
  'MOT_PWM_TYPE',
  'Q_M_PWM_TYPE',
  'SERVO_DSHOT_RATE',
  'SERVO_DSHOT_ESC',
  'SERVO_BLH_AUTO',
  'SERVO_BLH_MASK',
  'SERVO_BLH_BDMASK',
  'SERVO_BLH_RVMASK',
  'SERVO_BLH_3DMASK',
  'SERVO_BLH_POLES',
  'SERVO_BLH_TRATE',
  'SERVO_BLH_OTYPE',
  'SERVO_BLH_PORT',
])

/** Everything the ESC pass-through dialog owns, and nothing else. */
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
 * BLHeli and AM32 pass-through, behind a button.
 *
 * Nine parameters that matter on the day somebody is configuring ESCs and never
 * again, on a card whose other five are read every time the screen is opened.
 * They also only exist on hardware, so on SITL the button is not there at all
 * rather than opening an empty dialog.
 *
 * What these settings do is *enable* ArduPilot's pass-through: they put the
 * ESCs' own 4-way interface on a MAVLink serial channel for BLHeliSuite or the
 * AM32 configurator to reach. Being that configurator is a different feature.
 */
function EscSettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <LaModal
      open
      title="ESC pass-through"
      actions={
        <LaButton variant="primary" onClick={onClose}>
          Close
        </LaButton>
      }
    >
      {/* Staged, like the card that opens this. So the button says Close
          rather than Done: nothing here is sent until the card's own Write is
          pressed, and its count includes whatever was changed in here. */}
      <div className="esc-settings">
        {ESC_PARAMS.map((param) => (
          <ParamField key={param} param={param} label={ESC_LABELS[param] ?? param} showName />
        ))}
      </div>
    </LaModal>
  )
}

const ESC_LABELS: Record<string, string> = {
  SERVO_BLH_AUTO: 'Auto-enable on motors',
  SERVO_BLH_MASK: 'Pass-through outputs',
  SERVO_BLH_BDMASK: 'Bi-directional DShot',
  SERVO_BLH_RVMASK: 'Reversed outputs',
  SERVO_BLH_3DMASK: '3D outputs',
  SERVO_BLH_POLES: 'Motor poles',
  SERVO_BLH_TRATE: 'Telemetry rate',
  SERVO_BLH_OTYPE: 'Output type override',
  SERVO_BLH_PORT: 'Control port',
}

/**
 * Which outputs share a timer, and so must share a protocol.
 *
 * Bubbles rather than a line of text: this is the one thing on the card that
 * cannot be changed -- it is how the board is wired -- and next to five
 * dropdowns a plain row of values reads as another one. They are deliberately
 * not controls: no border a field has, no hover, no focus.
 *
 * Always drawn, always one row high. The card sits in a column whose height is
 * matched to the table beside it, so a block that appeared only for boards in
 * the generated table would move everything under it the moment a Cube was
 * plugged in. A dash is the answer when we cannot say, which is what the app
 * bar does for a reading the vehicle never gave.
 */
function TimerGroupBubbles({ name, id }: { name: string | null; id: number }) {
  const board = timerGroups(name, id)
  const full = board
    ? board.groups
        .map(([low, high, timer, nodma]) =>
          `${timer} ${low === high ? low : `${low}-${high}`}${nodma ? ' (no DMA)' : ''}`,
        )
        .join(', ')
    : undefined

  return (
    <div className="outproto__groups-row">
      <label className="la-field__label">Timer groups</label>
      {/* The name track, empty: this row is the board's own fact and has no
          parameter behind it, and leaving the track out would shift the
          bubbles left of every control above them. */}
      <span />
      <div className="outproto__bubbles" title={full}>
        {board ? (
          board.groups.map(([low, high, timer, nodma]) => (
            <span
              className={nodma ? 'outproto__bubble outproto__bubble--nodma' : 'outproto__bubble'}
              key={`${timer}-${low}`}
            >
              <span className="outproto__chans">{low === high ? low : `${low}-${high}`}</span>
              <span className="outproto__timer">{timer}</span>
            </span>
          ))
        ) : (
          <span className="outproto__bubble outproto__bubble--none">—</span>
        )}
      </div>
    </div>
  )
}

function MotorTestCard() {
  // The interlock is deliberate friction: nothing in this card spins until
  // the user has affirmed the props are off, once per session.
  const [interlocked, setInterlocked] = useState(false)
  // A fixed wing cannot run one. ArduPlane's whole motor_test.cpp is inside
  // `#if HAL_QUADPLANE_ENABLED` -- its own comment says it is there "so that
  // the quadplane pilot can test an individual motor" -- and the entry point,
  // `QuadPlane::mavlink_motor_test_start`, answers MAV_RESULT_FAILED at once
  // when `!available()`, which is Q_ENABLE at 0. So every button on this card
  // would be a refusal, which is the same reason the compass card checks
  // `use_for_yaw` before offering a calibration.
  //
  // Narrow on purpose: only a vehicle that *reports* Q_ENABLE and has it off
  // is excluded. Copter and Rover both ship a motor test of their own, and a
  // gate on "has multirotor motors" would have taken Rover's away.
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
  const [status, setStatus] = useState('')

  const test = async (motor: number) => {
    setStatus(`Motor ${letter(motor)}…`)
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
          ? `Motor ${letter(motor)}: spinning ${throttle}% for ${duration}s`
          : `Motor ${letter(motor)}: ${MAV_RESULT[result] ?? `result ${result}`}`,
      )
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'The vehicle did not answer.')
    }
  }

  if (qEnable === 0) return null

  // Nothing to draw for a fixed wing, or for a frame class this app has no
  // picture of -- the card still tests motors either way.
  const motors =
    frameClass === undefined ? null : frameLayout(frameClass, frameType ?? 0)

  // One button per step of this frame's sequence, or Mission Planner's eight
  // when the frame is not one we can draw. A tricopter's step 3 is its tail
  // servo, which is a real step and gets a button like the rest.
  const slots = motors
    ? motors.map((m) => m.test).sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6, 7, 8]

  // Two rows, always, split as evenly as the count allows. Every multirotor
  // ArduPilot can draw has an even number of test steps -- a tricopter's four
  // counts its tail servo -- so both rows come out the same length and the
  // keypad is a rectangle at every frame from a pair to a dodecahexa. An odd
  // count puts the extra key in the first row.
  const keyRows = splitKeypad(slots)

  /** What a test step actually reaches, for the button's hover. */
  const motorFor = (step: number) => {
    const m = motors?.find((x) => x.test === step)
    if (!m) return `Test step ${step}`
    return m.servo ? `Tail servo on channel ${m.n}` : `Motor ${m.n}`
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
    // The interlock is on the title row like every other card's action; the
    // friction is the confirm dialog, which is where it is actually read.
    // The result goes beside it rather than under the buttons, where an
    // empty hint collapsed and the card jumped on the first test.
    <LaCard
      className="motor-test"
      title="Motor test"
      subtitle="Props off"
      actions={
        <>
          {status && (
            <span className="card-status" role="status" title={status}>
              {status}
            </span>
          )}
          {/* One switch for the whole card. It stays on the title row in both
              states so the row never empties, and the friction is the confirm
              dialog behind it rather than the button's absence. */}
          {interlocked ? (
            <LaButton variant="ghost" onClick={() => setInterlocked(false)}>
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
      {/* The frame beside the controls rather than above them. Stacked, it was
          114px of picture over 300 of controls; here it takes the height of the
          whole column next to it, which is both taller for the drawing and
          shorter for the card. */}
      <div className="motor-test__body">
        {/* Everything is always here and disabled until the card is armed. It
            used to render nothing at all until then, so the card doubled in
            height on the first Enable -- and it sits in a column with another
            card under it, which then jumped too. */}
        <fieldset className="motor-test__controls" disabled={!interlocked}>
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
              onChange={(e) =>
                setDuration(Math.min(10, Math.max(0.5, Number(e.target.value) || 2)))
              }
            />
          </LaField>
          {/* One width for the set, so nine buttons read as a keypad rather
              than as labels of nine different lengths. */}
          {/* Lettered, like Mission Planner's, because these are positions in
              the test sequence and not motor numbers -- on a quad X, test B is
              motor 4. The drawing above carries the same letters, so the key
              is the letter alone; what it reaches is the hover, and the
              accessible name spells both out.
              Six to a row and two rows always: ArduPilot's ceiling is twelve
              motors, and a keypad that grew a row on a dodecahexa would move
              the Stop under it and the whole card with it. */}
          {/* The keys spin real motors, which the card's title does not say and
              its props-off subtitle only hints at. */}
          <p className="la-card__subtitle motor-test__what">Spin a motor</p>
          <div className="motor-test__keypad">
            {keyRows.map((row, i) => (
              <div
                className="motor-test__row"
                key={i}
                // The row's own key count, so it can cap its width at that many
                // keys and centre what is left -- a grid cannot ask "how many
                // children have I got".
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
          <div className="la-row motor-test__buttons">
            {/* Red, and an action: destructive controls are this app's one
                standing exception to status-only color. */}
            <LaButton variant="danger" onClick={() => void stopAll()}>
              Stop all
            </LaButton>
          </div>
        </fieldset>
        {motors && (
          <FrameDiagram motors={motors} className="motor-test__art" labels="test" />
        )}
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
