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
// Later steps the reminder down rather than clearing it, and only a *new*
// reason opens the dialog again.
//
// The stepped-down reminder is drawn to sit on a card's title row, beside
// the card's own actions, rather than as a block in the card body: a block
// appearing there made the card grow the moment somebody pressed Later. The
// reason it is owed is kept as the hover text, because the row has room for
// "Reboot required" and a button, not a sentence.
/**
 * A restart the vehicle owes, in one of two shapes.
 *
 * The dialog is mounted **once**, in the app shell: every card's actions used
 * to carry a whole prompt, so a screen with three cards stacked three dialogs
 * on top of each other, and a screen with none -- OSD, whose column uses
 * `VehicleParamActions` -- showed nothing at all when OSD_TYPE asked for a
 * restart, until a card-style Write mounted somewhere later and the prompt
 * surfaced over it. `inline` is what a card's title row keeps: after Later,
 * "Reboot required" and the button, where the edit was made.
 */
export default function RebootPrompt({ inline = false }: { inline?: boolean }) {
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

  if (inline !== deferred) return null

  if (deferred) {
    return (
      <span className="reboot-inline" title={pending}>
        <span className="reboot-inline__why">Reboot required</span>
        <LaButton variant="secondary" disabled={!connected || armed} onClick={reboot}>
          Reboot now
        </LaButton>
      </span>
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
      {/* ArduPilot refuses to reboot while armed, and this is a screen
          somebody could be on with the motors live. */}
      {armed && <p className="app-placeholder">Disarm the vehicle first.</p>}
    </LaModal>
  )
}
