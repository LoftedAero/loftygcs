import { useState } from 'react'
import { LaButton, LaHint, LaModal } from './La'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { rebootAutopilot } from '../../services/flight'

// Reboots the autopilot, for screens where a change only takes effect at
// boot (a reboot-required parameter, a compass calibration).
//
// It always confirms first: the link drops for about thirty seconds, and the
// dialog warns when the vehicle is armed rather than relying on ArduPilot's
// own refusal.

export interface RebootButtonProps {
  /** Shown under the button when a written parameter needs the reboot. */
  note?: string
  size?: 'block' | 'sm'
  /** Called once the reboot has been sent, so a prompt can retire itself. */
  onRebooted?: () => void
}

export default function RebootButton({ note, size = 'block', onRebooted }: RebootButtonProps) {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const armed = useVehicleStore((s) => s.armed)
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const reboot = () => {
    setAsking(false)
    setStatus('Rebooting…')
    const sent = () => {
      setStatus('Rebooting. It will reconnect on its own.')
      onRebooted?.()
    }
    // A rebooting vehicle often drops the link before acking, so a rejection
    // is expected; the link status reports the rest.
    void rebootAutopilot().then(sent, sent)
  }

  return (
    <>
      <LaButton variant="ghost" size={size} disabled={!connected} onClick={() => setAsking(true)}>
        Reboot autopilot
      </LaButton>
      {note && <LaHint>{note}</LaHint>}
      {status && <p className="app-col__note">{status}</p>}

      <LaModal
        open={asking}
        narrow
        title="Reboot the autopilot?"
        actions={
          <div className="la-prompt-actions">
            <LaButton variant="danger" size="block" onClick={reboot}>
              Reboot
            </LaButton>
            <LaButton variant="ghost" size="block" onClick={() => setAsking(false)}>
              Cancel
            </LaButton>
          </div>
        }
      >
        <p>
          {armed
            ? 'This vehicle is armed. Disarm before rebooting.'
            : 'Unwritten parameter edits are lost.'}
        </p>
      </LaModal>
    </>
  )
}
