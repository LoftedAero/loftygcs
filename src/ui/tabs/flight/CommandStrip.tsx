import { useEffect, useState, type Ref } from 'react'
import SlideConfirm from '../../components/SlideConfirm'
import { useFlightActions } from './useFlightActions'

// Compact mode's flight commands, over the bottom of the Fly screen: Arm or
// Disarm, and Takeoff while armed on the ground, the one command the mode
// picker cannot give. Everything else is a mode, changed from the app bar.
// Every command is confirmed by sliding, since a tap on a handheld can land
// by accident; the slider takes the buttons' place while it is up.

interface Command {
  id: string
  label: string
  /** The slider's prompt. */
  confirm: string
  danger?: boolean
  run: () => void
}

/** Below this, the vehicle is taken to be on the ground. */
const ON_GROUND_M = 2

export default function CommandStrip({ ref }: { ref?: Ref<HTMLDivElement> }) {
  const a = useFlightActions()
  const [pending, setPending] = useState<Command | null>(null)

  const commands: Command[] = []
  if (a.connected) {
    if (!a.armed) {
      commands.push({ id: 'arm', label: 'Arm', confirm: 'Slide to arm', run: a.arm })
    } else {
      commands.push({
        id: 'disarm',
        label: 'Disarm',
        confirm: 'Slide to disarm',
        danger: true,
        run: a.disarm,
      })
    }
    if (a.armed && a.takeoffVia !== 'unsupported' && a.relAltM < ON_GROUND_M) {
      commands.push({
        id: 'takeoff',
        label: 'Takeoff',
        confirm: 'Slide to take off',
        run: a.takeoff,
      })
    }
  }

  // A confirmation withdraws once its command stops applying, such as a
  // Disarm slider after the transmitter disarms.
  const ids = commands.map((c) => c.id).join(' ')
  useEffect(() => {
    if (pending && !ids.split(' ').includes(pending.id)) setPending(null)
  }, [ids, pending])

  return (
    <>
      {commands.length > 0 && (
        <div className="command-strip" ref={ref}>
          {pending ? (
            <SlideConfirm
              key={pending.id}
              label={pending.confirm}
              danger={pending.danger ?? false}
              onCancel={() => setPending(null)}
              onConfirm={() => {
                const c = pending
                setPending(null)
                c.run()
              }}
            />
          ) : (
            commands.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`command-strip__btn command-strip__${c.id}`}
                onClick={() => setPending(c)}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
      )}
      {a.forceArmDialog}
    </>
  )
}
