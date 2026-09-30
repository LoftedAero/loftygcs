import { useEffect, useRef, useState, type Ref } from 'react'
import SlideConfirm from '../../components/SlideConfirm'
import { useFlightActions } from './useFlightActions'

// Compact mode's flight commands, over the bottom of the Fly screen: Arm or
// Disarm, and Takeoff while armed on the ground, the one command the mode
// picker cannot give. Everything else is a mode, changed from the app bar.
// Every command is confirmed by sliding, since a tap on a handheld can land
// by accident; the slider takes the buttons' place while it is up. A refused
// arm offers force-arm the same way, never as a single tap.

interface Command {
  id: string
  label: string
  /** The slider's prompt. */
  confirm: string
  danger?: boolean
  primary?: boolean
  run: () => void
}

/** Above this since arming, the vehicle has flown, and Takeoff is withdrawn. */
const AIRBORNE_M = 2

export default function CommandStrip({ ref }: { ref?: Ref<HTMLDivElement> }) {
  const a = useFlightActions()
  const [pending, setPending] = useState<Command | null>(null)

  // Whether the vehicle has left the ground since it was armed. Relative
  // altitude alone would offer Takeoff to a vehicle flying low or below home,
  // and Takeoff switches the mode of whatever is flying.
  const airborne = useRef(false)
  if (!a.armed) airborne.current = false
  else if (a.relAltM > AIRBORNE_M) airborne.current = true

  const main: Command | null = !a.connected
    ? null
    : a.armed
      ? { id: 'disarm', label: 'Disarm', confirm: 'Slide to disarm', danger: true, run: a.disarm }
      : { id: 'arm', label: 'Arm', confirm: 'Slide to arm', primary: true, run: a.arm }
  const takeoff: Command | null =
    a.connected && a.armed && a.takeoffVia !== 'unsupported' && !airborne.current
      ? { id: 'takeoff', label: 'Takeoff', confirm: 'Slide to take off', run: a.takeoff }
      : null
  const force: Command | null =
    a.connected && !a.armed && a.forceArmOffered
      ? {
          id: 'force',
          label: 'Force arm',
          confirm: 'Slide to force arm',
          danger: true,
          run: a.forceArm,
        }
      : null

  // A refused arm goes straight to the force-arm slider.
  useEffect(() => {
    if (force) setPending(force)
    // Keyed on the offer, not the object rebuilt each render.
  }, [force !== null])

  // A confirmation withdraws once its command stops applying, such as a
  // Disarm slider after the transmitter disarms.
  const ids = [main?.id, takeoff?.id, force?.id].filter(Boolean).join(' ')
  useEffect(() => {
    if (pending && !ids.split(' ').includes(pending.id)) setPending(null)
  }, [ids, pending])

  if (!main) return null
  return (
    <div className="command-strip" ref={ref}>
      {pending ? (
        <SlideConfirm
          key={pending.id}
          label={pending.confirm}
          danger={pending.danger ?? false}
          primary={pending.primary ?? false}
          onCancel={() => {
            if (pending.id === 'force') a.dismissForceArm()
            setPending(null)
          }}
          onConfirm={() => {
            const c = pending
            setPending(null)
            c.run()
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className={`command-strip__btn command-strip__${main.id}`}
            onClick={() => setPending(main)}
          >
            {main.label}
          </button>
          {/* Beside Arm or Disarm, outside the row's centered width, so
              Disarm stays put when Takeoff comes and goes. */}
          {takeoff && (
            <button
              type="button"
              className="command-strip__btn command-strip__side"
              onClick={() => setPending(takeoff)}
            >
              {takeoff.label}
            </button>
          )}
        </>
      )}
    </div>
  )
}
