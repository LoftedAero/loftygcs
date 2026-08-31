import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { SENSOR_BITS } from '../../../protocol/sensors'
import { armReadiness, batteryLabel, isFailsafe, linkLabel } from './hud-draw'
import { paintHud } from './hud-paint'
import VideoLayer from './VideoLayer'
import { videoService } from '../../../services/video'

// The HUD as a stack of layers rather than one canvas:
//
//   background   <- video goes here when there is a source (see video.ts)
//   horizon      <- artificial horizon and its instruments, switchable
//   overlays     <- tapes, state and telemetry, switchable
//
// That is what makes "video with no horizon" and "instruments with no video"
// ordinary states rather than special cases. Everything is drawn on one
// canvas from the telemetry rings on requestAnimationFrame: full telemetry
// rate, zero React re-renders. The slower numbers come from the store
// snapshot, read imperatively for the same reason. How it looks is in
// hud-paint.ts; this is only the loop that feeds it.

export interface HudProps {
  /** Draw the horizon and its instruments. Off leaves the background showing. */
  horizon: boolean
  /** Draw the tapes, state and telemetry over whatever is behind them. */
  overlays: boolean
  /** Screen position of a right-click on the HUD, for its own menu. */
  onContextMenu?: (p: { x: number; y: number }) => void
}

/** How long "ARMED" stays on screen after the transition. */
const ARMED_BANNER_MS = 4000

export default function Hud({ horizon, overlays, onContextMenu }: HudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the animation frame rather than closed over, so toggling a
  // layer does not have to tear down and restart the loop.
  const flags = useRef({ horizon, overlays })
  flags.current = { horizon, overlays }
  // When the armed state last changed, so ARMED can announce itself and then
  // get out of the way. DISARMED stays up: on the ground it is the answer to
  // "why did nothing happen", and in the air it never appears.
  const armedAt = useRef({ armed: false, at: 0 })
  // Whether there is a picture behind the canvas. A ref, read inside the
  // frame, so a stream starting does not re-render anything.
  const videoBehind = useRef(false)
  useEffect(
    () => videoService.onStatus((s) => (videoBehind.current = s.state === 'playing')),
    [],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const v = useVehicleStore.getState()
      const link = useConnectionStore.getState().linkStats
      const now = Date.now()
      if (v.armed !== armedAt.current.armed) armedAt.current = { armed: v.armed, at: now }

      paintHud(ctx, w, h, {
        roll: telemetryRings.rollRad.latest(),
        pitch: telemetryRings.pitchRad.latest(),
        headingDeg: v.headingDeg,
        airspeedMs: v.airspeedMs,
        groundspeedMs: v.groundspeedMs,
        relAltM: v.relAltM,
        climbMs: v.climbMs,
        throttlePct: v.throttlePct,
        batteryText: batteryLabel(v.batteryV, v.batteryA, v.batteryPct),
        // rxCount is already the count over the last second, so it is the
        // packet rate as it stands.
        linkText: linkLabel(v.rcRssi, link?.rxCount),
        modeName: v.modeName,
        armed: v.armed,
        showArmedBanner: v.armed && now - armedAt.current.at < ARMED_BANNER_MS,
        failsafe: isFailsafe(v.systemStatus),
        readiness: armReadiness(v.armed, v.sensorsPresent, v.sensorsHealth, SENSOR_BITS.prearm),
        horizon: flags.current.horizon,
        overlays: flags.current.overlays,
        videoBehind: videoBehind.current,
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className="flight-hud"
      onContextMenu={(e) => {
        if (!onContextMenu) return
        // Ours replaces the browser's, the same bargain the map makes.
        e.preventDefault()
        onContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* The background layer: decoded video, behind the instruments. */}
      <div className="flight-hud__background">
        <VideoLayer />
      </div>
      <canvas ref={canvasRef} className="flight-hud__canvas" />
    </div>
  )
}
