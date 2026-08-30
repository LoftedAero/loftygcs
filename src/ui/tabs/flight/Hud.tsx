import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'

// The HUD as a stack of layers rather than one canvas:
//
//   background   <- video goes here when there is a source (see video.ts)
//   horizon      <- artificial horizon, switchable
//   overlays     <- telemetry readouts, switchable
//
// That is what makes "video with no horizon" and "instruments with no video"
// ordinary states rather than special cases. Both layers draw on the same
// canvas because both are rAF-driven from the telemetry rings: at full
// telemetry rate, with zero React re-renders. The slower numbers come from
// the store snapshot, read imperatively for the same reason.

export interface HudProps {
  /** Draw the artificial horizon. Off leaves the background showing through. */
  horizon: boolean
  /** Draw the telemetry readouts over whatever is behind them. */
  overlays: boolean
}

export default function Hud({ horizon, overlays }: HudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the animation frame rather than closed over, so toggling a
  // layer does not have to tear down and restart the loop.
  const flags = useRef({ horizon, overlays })
  flags.current = { horizon, overlays }

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
      if (w === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Cleared, not painted over: whatever is in the background layer has to
      // show through wherever this frame does not draw.
      ctx.clearRect(0, 0, w, h)

      const roll = telemetryRings.rollRad.latest()
      const pitch = telemetryRings.pitchRad.latest()
      const v = useVehicleStore.getState()
      const cx = w / 2
      const cy = h / 2
      // Everything is drawn proportional to the panel, because this one is
      // resizable now: fixed pixel constants that suited a 340x220 corner
      // panel leave a full-window HUD with a hairline ladder and a symbol
      // lost in the middle. Pitch is tied to height so a fixed span of sky
      // is visible at any size; the rest is clamped so the markings stay
      // legible without becoming billboards.
      const pxPerDeg = h / 80
      const s = Math.min(1.4, Math.max(0.85, Math.min(w, h) / 300))

      if (flags.current.horizon) {
        const pitchPx = ((pitch * 180) / Math.PI) * pxPerDeg
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, w, h)
        ctx.clip()
        ctx.translate(cx, cy)
        ctx.rotate(-roll)
        ctx.translate(0, pitchPx)

        // Sky and ground, oversized so a full roll never shows an edge.
        ctx.fillStyle = '#7FB2E5'
        ctx.fillRect(-w * 2, -h * 4, w * 4, h * 4)
        ctx.fillStyle = '#9B7B4F'
        ctx.fillRect(-w * 2, 0, w * 4, h * 4)
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 2 * s
        ctx.beginPath()
        ctx.moveTo(-w * 2, 0)
        ctx.lineTo(w * 2, 0)
        ctx.stroke()

        // Pitch ladder every 10°, out to the edge of what the panel shows.
        const rung = 26 * s
        ctx.fillStyle = '#FFFFFF'
        ctx.font = `${Math.round(10 * s)}px "Roboto Mono", monospace`
        ctx.textAlign = 'center'
        ctx.lineWidth = 1.5 * s
        const maxDeg = Math.ceil(h / 2 / pxPerDeg / 10) * 10
        for (let deg = -maxDeg; deg <= maxDeg; deg += 10) {
          if (deg === 0) continue
          const y = -deg * pxPerDeg
          ctx.beginPath()
          ctx.moveTo(-rung, y)
          ctx.lineTo(rung, y)
          ctx.stroke()
          ctx.fillText(String(Math.abs(deg)), rung + 15 * s, y + 3 * s)
        }
        ctx.restore()
      }

      if (flags.current.overlays) {
        // Fixed aircraft symbol: brand orange, always level.
        ctx.strokeStyle = '#F7941D'
        ctx.lineWidth = 3 * s
        ctx.beginPath()
        ctx.moveTo(cx - 40 * s, cy)
        ctx.lineTo(cx - 12 * s, cy)
        ctx.moveTo(cx + 12 * s, cy)
        ctx.lineTo(cx + 40 * s, cy)
        ctx.moveTo(cx, cy - 6 * s)
        ctx.lineTo(cx, cy)
        ctx.stroke()

        // Corner readouts. Outlined, because over video they land on
        // whatever colour the camera happened to be looking at.
        ctx.font = `${Math.round(12 * s)}px "Roboto Mono", monospace`
        ctx.lineWidth = 3 * s
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
        ctx.fillStyle = '#FFFFFF'
        const label = (text: string, x: number, y: number, align: CanvasTextAlign) => {
          ctx.textAlign = align
          ctx.strokeText(text, x, y)
          ctx.fillText(text, x, y)
        }
        const pad = 8 * s
        label(`GS ${v.groundspeedMs.toFixed(1)} m/s`, pad, 14 * s, 'left')
        label(`THR ${v.throttlePct.toFixed(0)}%`, pad, h - pad, 'left')
        label(`ALT ${v.relAltM.toFixed(1)} m`, w - pad, 14 * s, 'right')
        label(`HDG ${v.headingDeg.toFixed(0)}°`, w - pad, h - pad, 'right')
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flight-hud">
      {/* The background layer. Empty until a video source is configured; see
          video.ts for what is meant to land here. */}
      <div className="flight-hud__background" />
      <canvas ref={canvasRef} className="flight-hud__canvas" />
    </div>
  )
}
