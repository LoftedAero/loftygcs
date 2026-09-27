import { LaButton } from '../components/La'
import { useJoystickStore } from '../../stores/joystick-store'
import { stop } from '../../services/joystick'

// Shows on the app bar while the gamepad has control, with a way to release
// it. Control persists across screens (services/joystick.ts), so this has to
// be visible everywhere. It sits in the bar's middle track, so appearing
// moves no other control.
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
