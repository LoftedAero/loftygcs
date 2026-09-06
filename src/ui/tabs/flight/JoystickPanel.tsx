import { useEffect, useState } from 'react'
import { LaButton, LaField, LaHint, LaInput, LaModal, LaSelect } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useJoystickStore } from '../../../stores/joystick-store'
import { enable, startReading, stop, stopReading } from '../../../services/joystick'
import { CHANNEL_NAMES, PWM_MAX, PWM_MIN, type JoystickConfig } from '../../../protocol/joystick'

// Flying with a gamepad.
//
// The panel is deliberately plain about what it is. Taking control is one
// switch, it is off every time the app starts, and the bar for each channel
// shows what is being sent -- because the failure this feature has is a
// stick that is not where the pilot thinks it is.
//
// Reading the pad and sending it are separate: opening this panel starts
// reading, so the bars move and the mapping can be set up with nothing
// leaving the machine. Only the switch sends.

export default function JoystickPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const pad = useJoystickStore((s) => s.pad)
  const pads = useJoystickStore((s) => s.pads)
  const deviceId = useJoystickStore((s) => s.deviceId)
  const chooseDevice = useJoystickStore((s) => s.chooseDevice)
  const axes = useJoystickStore((s) => s.axes)
  const channels = useJoystickStore((s) => s.channels)
  const active = useJoystickStore((s) => s.active)
  const message = useJoystickStore((s) => s.message)
  const config = useJoystickStore((s) => s.config)
  const setConfig = useJoystickStore((s) => s.setConfig)
  const [setup, setSetup] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    startReading()
    return stopReading
  }, [])

  const take = () => {
    const refused = enable()
    if (refused) useJoystickStore.getState().setMessage(refused)
    setConfirming(false)
  }

  return (
    <div className="joystick-panel">
      <div className="joystick-panel__row">
        <span className="joystick-panel__label">Joystick</span>

        {/* One device needs no choosing; several do, and choosing for
            someone is choosing which sticks they are holding. The list is
            by the id the browser reports, because indices shuffle between
            sessions. */}
        {pads.length > 1 ? (
          <LaSelect
            aria-label="Which device to fly with"
            className="joystick-panel__pick"
            value={deviceId ?? ''}
            disabled={active}
            onChange={(e) => chooseDevice(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Choose a device…</option>
            {pads.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </LaSelect>
        ) : (
          <span className="joystick-panel__pad">
            {pad ? pad.id : 'no gamepad — press a button on it'}
          </span>
        )}

        <LaButton
          variant={active ? 'danger' : 'primary'}
          size="sm"
          disabled={!connected || !pad}
          onClick={() => (active ? stop() : setConfirming(true))}
        >
          {active ? 'Release control' : 'Take control'}
        </LaButton>
        <LaButton variant="ghost" size="sm" disabled={active} onClick={() => setSetup(true)}>
          Set up…
        </LaButton>
      </div>

      <div className="joystick-panel__row">
        {config.axes.map((map) => (
          <ChannelBar
            key={map.channel}
            name={CHANNEL_NAMES[map.channel] ?? `Ch ${map.channel}`}
            pwm={channels[map.channel - 1]}
          />
        ))}
        {active && <span className="joystick-panel__live">sending</span>}
      </div>

      {pads.length > 1 && !pad && (
        <LaHint>
          {deviceId
            ? 'That device is no longer attached. Choose another.'
            : 'Several input devices are attached. Choose the one to fly with — nothing is read until you do.'}
        </LaHint>
      )}

      {message && <LaHint error={active === false}>{message}</LaHint>}

      <LaModal
        open={confirming}
        narrow
        title="Fly with the gamepad?"
        actions={
          <div className="la-prompt-actions">
            <LaButton variant="danger" size="block" onClick={take}>
              Take control
            </LaButton>
            <LaButton variant="ghost" size="block" onClick={() => setConfirming(false)}>
              Cancel
            </LaButton>
          </div>
        }
      >
        <p>
          The vehicle will read this gamepad as its receiver. Control is handed back if the window
          loses focus, the gamepad is unplugged, or the link drops — but a transmitter is still the
          thing to reach for if anything goes wrong.
        </p>
      </LaModal>

      <SetupModal
        open={setup}
        onClose={() => setSetup(false)}
        axes={axes}
        config={config}
        setConfig={setConfig}
      />
    </div>
  )
}

/**
 * Mapping the sticks.
 *
 * A dialog rather than a page: it is opened once for a new gamepad and then
 * never again, and it must not be reachable while control is taken.
 */
function SetupModal({
  open,
  onClose,
  axes: live,
  config,
  setConfig,
}: {
  open: boolean
  onClose: () => void
  axes: number[]
  config: JoystickConfig
  setConfig: (patch: Partial<JoystickConfig>) => void
}) {
  return (
    <LaModal
      open={open}
      title="Gamepad setup"
      actions={
        <LaButton variant="secondary" onClick={onClose}>
          Done
        </LaButton>
      }
    >
      <p className="la-hint">
        Move a stick to see which axis it is, then give that axis to a channel. Nothing is sent
        while this is open.
      </p>
      <table className="joystick-setup">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Axis</th>
            <th>Reverse</th>
            <th className="num">Live</th>
          </tr>
        </thead>
        <tbody>
          {config.axes.map((map, i) => (
            <tr key={map.channel}>
              <td>{CHANNEL_NAMES[map.channel] ?? `Ch ${map.channel}`}</td>
              <td>
                <LaSelect
                  aria-label={`Axis for channel ${map.channel}`}
                  value={String(map.axis)}
                  onChange={(e) => {
                    const next = [...config.axes]
                    next[i] = { ...map, axis: Number(e.target.value) }
                    setConfig({ axes: next })
                  }}
                >
                  <option value="-1">None</option>
                  {live.map((_, index) => (
                    <option key={index} value={index}>
                      Axis {index}
                    </option>
                  ))}
                </LaSelect>
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Reverse channel ${map.channel}`}
                  checked={map.reverse}
                  onChange={(e) => {
                    const next = [...config.axes]
                    next[i] = { ...map, reverse: e.target.checked }
                    setConfig({ axes: next })
                  }}
                />
              </td>
              <td className="num">{live[map.axis]?.toFixed(2) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <LaField label="Deadzone" htmlFor="js-deadzone" unit="%">
        <LaInput
          id="js-deadzone"
          type="number"
          min={0}
          max={40}
          value={Math.round(config.deadzone * 100)}
          onChange={(e) =>
            setConfig({ deadzone: Math.min(0.4, Math.max(0, Number(e.target.value) / 100)) })
          }
        />
      </LaField>
      <LaHint>
        The throttle keeps its full travel: a deadzone only applies to the axes that rest in the
        middle.
      </LaHint>
    </LaModal>
  )
}

/** One channel as a bar, because a number does not show a stuck stick. */
function ChannelBar({ name, pwm }: { name: string; pwm: number | undefined }) {
  const value = pwm === undefined || pwm === 65535 ? null : pwm
  const pct = value === null ? 0 : ((value - PWM_MIN) / (PWM_MAX - PWM_MIN)) * 100
  return (
    <span className="joystick-bar" title={`${name}: ${value ?? 'not sent'}`}>
      <span className="joystick-bar__name">{name}</span>
      <span className="joystick-bar__track">
        {value !== null && (
          <span className="joystick-bar__fill" style={{ width: `${pct.toFixed(1)}%` }} />
        )}
        <span className="joystick-bar__mid" />
      </span>
      <span className="joystick-bar__value">{value ?? '—'}</span>
    </span>
  )
}
