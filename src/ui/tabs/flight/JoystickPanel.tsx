import { useState } from 'react'
import { LaButton, LaHint, LaModal, LaSelect } from '../../components/La'
import { useConnectionStore } from '../../../stores/connection-store'
import { useJoystickStore } from '../../../stores/joystick-store'
import { enable, stop } from '../../../services/joystick'
import { PWM_MAX, PWM_MID, PWM_MIN, channelName } from '../../../protocol/joystick'
import StickDiagram from '../radio/StickDiagram'
import type { StickFunction } from '../radio/radio-cal'
import JoystickSetup from './JoystickSetup'

// Flying with a gamepad. The pane shows what is being sent: the sticks on the
// Radio screen's transmitter drawing, and a bar per mapped channel. Mapping is
// edited only in the Configure dialog.
//
// Control is off at every start. The gamepad is read for the whole session
// (services/joystick.ts), so closing this pane or leaving Fly does not drop
// control; the app bar shows it, with a Release, on every screen.

/** Mode 2 and ArduPilot's default RCMAP: the channel each stick drives. */
const STICK_CHANNELS: Record<StickFunction, number> = { roll: 1, pitch: 2, throttle: 3, yaw: 4 }

export default function JoystickPanel() {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const pad = useJoystickStore((s) => s.pad)
  const pads = useJoystickStore((s) => s.pads)
  const deviceId = useJoystickStore((s) => s.deviceId)
  const chooseDevice = useJoystickStore((s) => s.chooseDevice)
  const channels = useJoystickStore((s) => s.channels)
  const active = useJoystickStore((s) => s.active)
  const message = useJoystickStore((s) => s.message)
  const config = useJoystickStore((s) => s.config)
  const [setup, setSetup] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const take = () => {
    const refused = enable()
    if (refused) useJoystickStore.getState().setMessage(refused)
    setConfirming(false)
  }

  // Every driven channel in order: the sticks plus any sliders and switches
  // added in Configure.
  const mapped = [
    ...new Set([
      ...config.axes.filter((a) => a.axis >= 0).map((a) => a.channel),
      // A flight mode button drives no channel.
      ...config.buttons.filter((b) => b.button >= 0 && b.mode !== 'mode').map((b) => b.channel),
    ]),
  ].sort((a, b) => a - b)

  // An undriven stick stays centered and unlit.
  const positions: Partial<Record<StickFunction, number>> = {}
  if (pad) {
    for (const [fn, ch] of Object.entries(STICK_CHANNELS) as [StickFunction, number][]) {
      const v = positionOf(channels[ch - 1])
      if (mapped.includes(ch) && v !== null) positions[fn] = (v - PWM_MID) / (PWM_MAX - PWM_MID)
    }
  }

  return (
    <div className="joystick-panel">
      <div className="joystick-panel__row">
        <span className="joystick-panel__label">Device</span>

        {/* Always a select so the row keeps its shape. With several devices
            the user must choose; entries are keyed by the browser's id
            because indices shuffle between sessions. Chromium hides all
            gamepads until a button is pressed after startup, so empty is
            normal at launch. */}
        <LaSelect
          aria-label="Which device to fly with"
          className="joystick-panel__pick"
          title={pad?.id}
          value={pads.length === 0 ? '' : (deviceId ?? (pads.length === 1 ? pads[0]!.id : ''))}
          disabled={active || pads.length === 0}
          onChange={(e) => chooseDevice(e.target.value === '' ? null : e.target.value)}
        >
          {pads.length === 0 ? (
            <option value="">Press a button on a controller</option>
          ) : (
            pads.length > 1 && <option value="">Choose a device</option>
          )}
          {/* Keep a remembered but detached device listed, so another is not
              shown as chosen. */}
          {deviceId && !pads.some((p) => p.id === deviceId) && pads.length > 0 && (
            <option value={deviceId}>{padName(deviceId)}</option>
          )}
          {pads.map((p) => (
            <option key={p.id} value={p.id}>
              {padName(p.id)}
            </option>
          ))}
        </LaSelect>

        <LaButton
          variant={active ? 'danger' : 'primary'}
          disabled={!connected || !pad}
          onClick={() => (active ? stop() : setConfirming(true))}
        >
          {active ? 'Release control' : 'Take control'}
        </LaButton>
        <LaButton variant="secondary" disabled={active} onClick={() => setSetup(true)}>
          Configure
        </LaButton>
      </div>

      <div className="joystick-panel__body">
        <div className="joystick-panel__sticks">
          <StickDiagram active={null} positions={positions} />
        </div>

        <div className="joystick-panel__main">
          <div className="joystick-panel__bars">
            {mapped.map((ch) => (
              <ChannelBar key={ch} name={channelName(ch)} pwm={channels[ch - 1]} />
            ))}
          </div>

          {/* The select cannot show that the chosen device is detached. */}
          {deviceId && !pad && pads.length > 0 && (
            <LaHint>That device is no longer attached.</LaHint>
          )}
          {message && <LaHint error>{message}</LaHint>}
        </div>
      </div>

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
        <p>The vehicle will fly on this gamepad's controls. Keep a transmitter to hand.</p>
      </LaModal>

      <JoystickSetup open={setup} onClose={() => setSetup(false)} />
    </div>
  )
}

/** A channel value that is a position; 0 and the ignore/release values are not. */
function positionOf(pwm: number | undefined): number | null {
  return pwm === undefined || pwm === 0 || pwm >= 65534 ? null : pwm
}

/**
 * A device's name without the browser's decoration: Chromium appends
 * "(STANDARD GAMEPAD Vendor: 045e Product: 02fd)" and Firefox prefixes
 * "045e-02fd-". The full id remains the storage key.
 */
export function padName(id: string): string {
  const name = id
    .replace(/\s*\([^)]*(?:Vendor:|STANDARD GAMEPAD)[^)]*\)\s*$/i, '')
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .trim()
  return name || id
}

/** One channel as a bar, because a number does not show a stuck stick. */
function ChannelBar({ name, pwm }: { name: string; pwm: number | undefined }) {
  const value = positionOf(pwm)
  const pct = value === null ? 0 : ((value - PWM_MIN) / (PWM_MAX - PWM_MIN)) * 100
  return (
    <span className="joystick-bar" title={`${name}: ${value ?? 'not sent'}`}>
      <span className="joystick-bar__name">{name}</span>
      <span className="joystick-bar__track">
        {value !== null && (
          <span
            className="joystick-bar__fill"
            style={{ width: `${Math.min(100, Math.max(0, pct)).toFixed(1)}%` }}
          />
        )}
        <span className="joystick-bar__mid" />
      </span>
      <span className="joystick-bar__value">{value ?? '—'}</span>
    </span>
  )
}
