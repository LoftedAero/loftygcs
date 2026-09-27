import { LaButton, LaModal } from './La'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { rebootAutopilot } from '../../services/flight'

// Prompts for a reboot after a change the vehicle only reads at boot: a
// `writeNow` field whose metadata says RebootRequired, or a finished compass
// calibration (the running firmware still uses the old offsets).
//
// "Later" steps the dialog down to an inline reminder rather than clearing
// it, so several changes can share one reboot; only a new reason reopens the
// dialog. The inline form sits on a card's title row so the card does not
// grow, with the reason as hover text.
/**
 * A pending reboot, as a dialog or (with `inline`) the stepped-down reminder
 * on a card's title row. The dialog is mounted once, in the app shell.
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
    // A rebooting vehicle often drops the link before acking, so a rejection
    // is expected; the link status reports the rest.
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
      {/* ArduPilot refuses to reboot while armed. */}
      {armed && <p className="app-placeholder">Disarm the vehicle first.</p>}
    </LaModal>
  )
}
