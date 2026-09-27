import { LaButton } from '../components/La'
import { useJoystickStore } from '../../stores/joystick-store'
import { stop } from '../../services/joystick'

// The gamepad has control, said from every screen.
//
// Control is no longer dropped when the Joystick pane closes or the Fly screen
// is left (services/joystick.ts), so the one place that is always in view has
// to say so and offer the way out. Nothing is drawn otherwise: the app bar
// draws no indicator for a state that is not happening. It sits in the bar's
// middle band, the one track allowed to change size, so appearing moves none
// of the controls either side of it.
export default function JoystickChip() {
  const active = useJoystickStore((s) => s.active)
  if (!active) return null
  return (
    <div className="app-joystick" role="status">
      <span className="app-joystick__label">
        <span className="app-joystick__dot" aria-hidden="true" />
        Joystick
      </span>
      <LaButton variant="danger" onClick={() => stop()}>
        Release
      </LaButton>
    </div>
  )
}
