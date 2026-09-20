import { LaCard, LaHint } from '../../components/La'
import { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
import CardParamActions from '../../components/CardParamActions'
import { useConnectionStore } from '../../../stores/connection-store'
import { useParamStore } from '../../../stores/param-store'
import { useVehicleStore } from '../../../stores/vehicle-store'

/**
 * ArduPilot's six mode slots are selected by PWM band on one channel.
 * Boundaries are firmware-defined (RC_Channel::read_mode_switch).
 * Returns 1-6, or 0 when there is no usable reading.
 */
export function modeSlotForPwm(pwm: number): number {
  if (!pwm || pwm < 800) return 0
  if (pwm <= 1230) return 1
  if (pwm <= 1360) return 2
  if (pwm <= 1490) return 3
  if (pwm <= 1620) return 4
  if (pwm <= 1749) return 5
  return 6
}

// Which modes the mode switch can reach. Showing the live slot turns this
// from a form into a check you can perform: flick the switch, watch the row
// light up, know the radio and the parameters agree.
export default function FlightModesTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)
  const ready = useParamStore((s) => s.loadState === 'ready')
  const channels = useVehicleStore((s) => s.rcChannels)
  const currentMode = useVehicleStore((s) => s.modeName)

  // Parameters too, not just a link: with them still arriving every FLTMODE is
  // missing, and the empty-set branch below would announce that this vehicle
  // has no mode switch -- which is a statement about the aircraft, made while
  // the download that would disprove it is still running.
  if (!connected || !ready) {
    return (
      <NeedsVehicle title="Flight modes" />
    )
  }

  // Simple and super simple are Copter's; a plane reports neither, and a row
  // reading "not on this vehicle" is what `ParamCard` existed to prevent --
  // this card builds its own rows, so it carries the rule itself.
  const has = (param: string) => entries.has(param)
  const modeCh = entries.get('FLTMODE_CH')?.value ?? 5
  const pwm = channels[modeCh - 1] ?? 0
  const activeSlot = modeSlotForPwm(pwm)
  const slots = [1, 2, 3, 4, 5, 6].filter((n) => entries.has(`FLTMODE${n}`))

  if (slots.length === 0) {
    return (
      // Plane and Rover name these differently and some builds omit them
      // entirely; the Parameters tab is where the full set stays reachable.
      <LaCard title="Flight modes" note="This vehicle does not report mode-switch parameters." />
    )
  }

  return (
    // One card, because it is one setting: a channel, the six modes it selects
    // between, and the handful of things that qualify them. Two cards said
    // there were two subjects here and put the mode a vehicle boots into on
    // the far side of a card boundary from the modes it boots into.
    //
    // Staged rather than written on change, which is Mission Planner's own
    // choice on this screen -- its six dropdowns sit behind one Save Modes
    // button. Measured on Copter 4.7.1, writing the slot the switch is already
    // sitting in does *not* move the aircraft, so either would have been safe
    // on the ground; the deciding argument was consistency with the tool
    // everyone arriving here has already used.
    <LaCard
      title="Mode switch"
      actions={
        <CardParamActions
          reason="Flight mode changes take effect after a restart"
          owns={(param) => MODE_PARAMS.has(param) || /^FLTMODE[1-6]$/.test(param)}
        />
      }
    >
      {/* The two settings that frame the table -- which channel selects a
          slot, and which slot the vehicle wakes up in -- side by side above
          it with their labels stacked, the way the compass card carries the
          settings that apply to its whole table. One row reads as one group,
          where two rows above a table read as more of the table. */}
      <div className="sensor-fields">
        {has('FLTMODE_CH') && <ParamField param="FLTMODE_CH" label="Mode channel" stacked />}
        {has('INITIAL_MODE') && <ParamField param="INITIAL_MODE" label="Mode at boot" stacked />}
      </div>
      <div className="app-table">
        <div className="app-table__row modes-grid app-table__head">
          <span>Slot</span>
          <span>Mode</span>
          <span>PWM range</span>
        </div>
        {slots.map((n) => (
          <div
            className={
              n === activeSlot
                ? 'app-table__row modes-grid modes-grid--active'
                : 'app-table__row modes-grid'
            }
            key={n}
            title={n === activeSlot ? 'Current switch position' : undefined}
          >
            <span className="app-table__label">
              {n === activeSlot && <span className="modes-grid__marker" aria-hidden="true" />}
              Mode {n}
            </span>
            <ParamField param={`FLTMODE${n}`} label={`Mode ${n}`} bare />
            <span className="modes-grid__range">{PWM_RANGES[n - 1]}</span>
          </div>
        ))}
      </div>
      {/* The live row and the reading under it are the check; saying "flick
          the switch and watch" is describing what the screen already shows. */}
      <LaHint>
        {activeSlot > 0
          ? `Channel ${modeCh} reads ${pwm} µs — slot ${activeSlot} selected, vehicle reports ${currentMode || '—'}.`
          : `No reading on channel ${modeCh}. Turn the transmitter on.`}
      </LaHint>
      {/* Which of the six fly relative to a heading rather than the nose. */}
      {has('SIMPLE') && <ParamField param="SIMPLE" label="Simple mode slots" />}
      {has('SUPER_SIMPLE') && <ParamField param="SUPER_SIMPLE" label="Super simple slots" />}
    </LaCard>
  )
}

/** The named parameters this card owns; the six slots are matched by shape. */
const MODE_PARAMS: ReadonlySet<string> = new Set([
  'FLTMODE_CH',
  'INITIAL_MODE',
  'SIMPLE',
  'SUPER_SIMPLE',
])

const PWM_RANGES = ['≤ 1230', '1231–1360', '1361–1490', '1491–1620', '1621–1749', '≥ 1750']
