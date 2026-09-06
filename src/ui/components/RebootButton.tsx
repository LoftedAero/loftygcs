import { useState } from 'react'
import { LaButton, LaHint, LaModal } from './La'
import { useConnectionStore } from '../../stores/connection-store'
import { useVehicleStore } from '../../stores/vehicle-store'
import { rebootAutopilot } from '../../services/flight'

// Restarting the autopilot, wherever that is the next thing to do.
//
// It lives here rather than on one page because the pages that need it are
// the ones where a change has just been made that the firmware only reads
// at boot -- a parameter marked reboot-required, a compass calibration --
// and each of those would otherwise grow its own copy.
//
// It always asks first. The vehicle drops the link and comes back thirty
// seconds later, and the same click on an armed aircraft is the click
// nobody meant to make. ArduPilot refuses to reboot while armed, but a
// station should not be the thing relying on that.

export interface RebootButtonProps {
  /** Shown under the button when a written parameter needs the reboot. */
  note?: string
  size?: 'block' | 'sm'
}

export default function RebootButton({ note, size = 'block' }: RebootButtonProps) {
  const connected = useConnectionStore((s) => s.phase === 'connected')
  const armed = useVehicleStore((s) => s.armed)
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const reboot = () => {
    setAsking(false)
    setStatus('Rebooting…')
    void rebootAutopilot().then(
      // The vehicle stops answering mid-command about as often as it acks,
      // so a rejection here is not news. The link status says the rest.
      () => setStatus('Rebooting. It will reconnect on its own.'),
      () => setStatus('Rebooting. It will reconnect on its own.'),
    )
  }

  return (
    <>
      <LaButton
        variant="ghost"
        size={size}
        disabled={!connected}
        onClick={() => setAsking(true)}
        title="Restart the flight controller"
      >
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
            : 'The link drops and comes back once it has booted. Unwritten parameter edits are lost.'}
        </p>
      </LaModal>
    </>
  )
}
