import { LaButton, LaModal } from './La'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { rebootAutopilot } from '../../services/flight'

// "You changed something the vehicle only reads at boot."
//
// Raised by any `writeNow` field whose ArduPilot metadata says
// RebootRequired, and by a finished compass calibration -- the offsets are
// saved and the running firmware is still using the old ones. Until the
// restart, the screen and the aircraft disagree.
//
// A dialog rather than a line on the card, because the line is easy to walk
// past and the consequence is an aircraft flying on settings nobody is
// looking at. **Later is a real answer**, though: somebody mid-bring-up has
// half a dozen changes to make and one reboot to do at the end, and a dialog
// with no way out teaches people to click the first button they see. So
// Later steps the reminder down to a line on the card rather than clearing
// it, and only a *new* reason opens the dialog again.
export default function RebootPrompt() {
  const pending = useWriteFeedbackStore((s) => s.rebootPending)
  const deferred = useWriteFeedbackStore((s) => s.rebootDeferred)
  const defer = useWriteFeedbackStore((s) => s.deferReboot)
  const done = useWriteFeedbackStore((s) => s.rebootDone)
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const armed = useVehicleStore((s) => s.armed)

  if (!pending) return null

  const reboot = () => {
    done()
    // The vehicle stops answering mid-command about as often as it acks, so
    // a rejection is not news -- the link status says the rest.
    void rebootAutopilot().catch(() => {})
  }

  if (deferred) {
    return (
      <div className="reboot-prompt">
        <p className="reboot-prompt__why">{pending}</p>
        <LaButton variant="secondary" size="sm" disabled={!connected || armed} onClick={reboot}>
          Reboot now
        </LaButton>
      </div>
    )
  }

  return (
    <LaModal
      open
      title={pending}
      actions={
        <>
          <LaButton variant="ghost" onClick={defer}>
            Later
          </LaButton>
          <LaButton variant="primary" disabled={!connected || armed} onClick={reboot}>
            Reboot now
          </LaButton>
        </>
      }
    >
      <p className="app-placeholder">
        The vehicle reads this at startup, so it is still running the old setting.
      </p>
      {/* ArduPilot refuses to reboot while armed, and this is a screen
          somebody could be on with the motors live. */}
      {armed && <p className="app-placeholder">Disarm the vehicle first.</p>}
    </LaModal>
  )
}
