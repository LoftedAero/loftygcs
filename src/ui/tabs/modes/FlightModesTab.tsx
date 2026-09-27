import { LaCard } from '../../components/La'
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

// Which modes the mode switch can reach. The live slot is highlighted, so
// flicking the switch checks that the radio and the parameters agree.
export default function FlightModesTab() {
  const connected = useConnectionStore((s) => s.phase === 'connected' || s.phase === 'linkLost')
  const entries = useParamStore((s) => s.entries)
  const ready = useParamStore((s) => s.loadState === 'ready')
  const channels = useVehicleStore((s) => s.rcChannels)

  // Wait for parameters too: mid-download every FLTMODE is missing, and the
  // empty-set branch below would wrongly report no mode switch.
  if (!connected || !ready) {
    return <NeedsVehicle title="Flight modes" />
  }

  // This card builds its own rows, so it drops missing parameters itself as
  // `ParamCard` would.
  const has = (param: string) => entries.has(param)
  const modeCh = entries.get('FLTMODE_CH')?.value ?? 5
  const pwm = channels[modeCh - 1] ?? 0
  const activeSlot = modeSlotForPwm(pwm)
  const slots = [1, 2, 3, 4, 5, 6].filter((n) => entries.has(`FLTMODE${n}`))

  if (slots.length === 0) {
    return (
      // Some vehicles and builds name these differently or omit them; the
      // Parameters tab still has the full set.
      <LaCard title="Flight modes" note="This vehicle does not report mode-switch parameters." />
    )
  }

  return (
    // One card: a channel, the six modes it selects between, and the settings
    // that qualify them. Edits are staged behind Write rather than sent on
    // change, like Mission Planner's Save Modes button.
    <LaCard
      title="Mode switch"
      actions={
        <CardParamActions
          reason="Flight mode changes take effect after a restart"
          owns={(param) => MODE_PARAMS.has(param) || /^FLTMODE[1-6]$/.test(param)}
        />
      }
    >
      {/* Settings that apply to the whole table, side by side above it. */}
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
      {/* The marked row follows the switch; with no reading, none is marked. */}
    </LaCard>
  )
}

/** The named parameters this card owns; the six slots are matched by shape. */
const MODE_PARAMS: ReadonlySet<string> = new Set(['FLTMODE_CH', 'INITIAL_MODE'])

const PWM_RANGES = ['≤ 1230', '1231–1360', '1361–1490', '1491–1620', '1621–1749', '≥ 1750']
