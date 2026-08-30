import { useEffect, useRef } from 'react'
import VehicleView, { type Attitude } from '../../components/VehicleView'
import type { AccelPositionId } from '../../../protocol/accel-cal'

const HALF = Math.PI / 2

/**
 * Held yaw, so the airframe is always seen at three-quarters. Square to the
 * camera, a vehicle rolled onto its side presents edge-on and collapses into
 * a sliver -- readable attitude matters more here than a symmetric view.
 */
const PRESENTATION_YAW = -0.62

// The attitude each side corresponds to, in ArduPilot's sense: roll right
// positive, pitch up positive.
const ATTITUDE: Record<AccelPositionId, { roll: number; pitch: number }> = {
  LEVEL: { roll: 0, pitch: 0 },
  LEFT: { roll: -HALF, pitch: 0 },
  RIGHT: { roll: HALF, pitch: 0 },
  NOSEDOWN: { roll: 0, pitch: -HALF },
  NOSEUP: { roll: 0, pitch: HALF },
  BACK: { roll: Math.PI, pitch: 0 },
}

const DURATION_MS = 650
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/**
 * The airframe held in the attitude the vehicle is asking for, turning
 * between sides so the movement itself shows which way to rotate it.
 *
 * The tween lives in a ref rather than React state: VehicleView samples the
 * attitude every frame, so nothing here needs to re-render.
 */
export default function AccelVehicleView({ position }: { position: AccelPositionId }) {
  const current = useRef<Attitude>({ roll: 0, pitch: 0, yaw: PRESENTATION_YAW })
  const from = useRef<Attitude>({ roll: 0, pitch: 0, yaw: PRESENTATION_YAW })
  const startedAt = useRef(0)

  useEffect(() => {
    from.current = { ...current.current }
    startedAt.current = performance.now()
  }, [position])

  const sample = (): Attitude => {
    const target = ATTITUDE[position]
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const t = reduced ? 1 : Math.min(1, (performance.now() - startedAt.current) / DURATION_MS)
    const k = easeInOut(t)
    current.current = {
      roll: from.current.roll + (target.roll - from.current.roll) * k,
      pitch: from.current.pitch + (target.pitch - from.current.pitch) * k,
      yaw: PRESENTATION_YAW,
    }
    return current.current
  }

  // Always the aircraft, whatever the vehicle is. A quad is nearly flat, so
  // rolled onto its side it is a sliver you cannot orient yourself against;
  // a wing and a fin read at every one of the six positions.
  return (
    <VehicleView vehicle="plane" attitude={sample} className="vehicle-view vehicle-view--cal" />
  )
}
