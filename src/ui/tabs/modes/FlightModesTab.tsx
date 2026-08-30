import { LaCard, LaHint } from '../../components/La'
import ParamCard, { NeedsVehicle } from '../../components/ParamCard'
import ParamField from '../../components/ParamField'
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
  const channels = useVehicleStore((s) => s.rcChannels)
  const currentMode = useVehicleStore((s) => s.modeName)

  if (!connected) {
    return (
      <NeedsVehicle
        title="Flight modes"
        body="The six mode-switch positions, the channel that selects them, and simple-mode options."
      />
    )
  }

  const modeCh = entries.get('FLTMODE_CH')?.value ?? 5
  const pwm = channels[modeCh - 1] ?? 0
  const activeSlot = modeSlotForPwm(pwm)
  const slots = [1, 2, 3, 4, 5, 6].filter((n) => entries.has(`FLTMODE${n}`))

  if (slots.length === 0) {
    return (
      <LaCard
        title="Flight modes"
        note="This vehicle does not report mode-switch parameters."
      >
        <p className="app-placeholder">
          Plane and Rover name these differently, and some builds omit them. The full set is
          always reachable on the Parameters tab.
        </p>
      </LaCard>
    )
  }

  return (
    <>
      <LaCard
        title="Mode switch"
        note="Flick through the switch positions to confirm each slot lights up where you expect."
      >
        <ParamField param="FLTMODE_CH" label="Mode channel" />
        <div className="modes-grid modes-grid--head">
          <span>Slot</span>
          <span>Mode</span>
          <span>PWM range</span>
        </div>
        {slots.map((n) => (
          <div
            className={n === activeSlot ? 'modes-grid modes-grid--active' : 'modes-grid'}
            key={n}
            title={n === activeSlot ? 'Current switch position' : undefined}
          >
            <span className="modes-grid__label">
              {n === activeSlot && <span className="modes-grid__marker" aria-hidden="true" />}
              Mode {n}
            </span>
            <ParamField param={`FLTMODE${n}`} label={`Mode ${n}`} bare />
            <span className="modes-grid__range">{PWM_RANGES[n - 1]}</span>
          </div>
        ))}
        <LaHint>
          {activeSlot > 0
            ? `Channel ${modeCh} reads ${pwm} µs — slot ${activeSlot} selected, vehicle reports ${currentMode || '—'}.`
            : `No reading on channel ${modeCh}. Turn the transmitter on.`}
        </LaHint>
      </LaCard>
      <ParamCard
        title="Options"
        note="Simple mode flies relative to where the vehicle was armed; super simple flies relative to home."
        fields={[
          { param: 'SIMPLE', label: 'Simple mode slots' },
          { param: 'SUPER_SIMPLE', label: 'Super simple slots' },
          { param: 'INITIAL_MODE', label: 'Mode at boot' },
          { param: 'FLTMODE_GCSBLOCK', label: 'Blocked GCS modes' },
        ]}
      />
    </>
  )
}

const PWM_RANGES = ['≤ 1230', '1231–1360', '1361–1490', '1491–1620', '1621–1749', '≥ 1750']
