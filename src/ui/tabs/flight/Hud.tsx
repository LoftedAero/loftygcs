import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'

// Canvas artificial horizon with speed/altitude readouts. Attitude reads
// the telemetry rings on requestAnimationFrame -- full telemetry rate,
// zero React re-renders. The slower numbers come from the store snapshot.
export default function Hud() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

      const roll = telemetryRings.rollRad.latest()
      const pitch = telemetryRings.pitchRad.latest()
      const v = useVehicleStore.getState()

      const cx = w / 2
      const cy = h / 2
      // Pitch: 1.6 px per degree of pitch keeps ±20° visible.
      const pitchPx = ((pitch * 180) / Math.PI) * 1.6

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
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(-w * 2, 0)
      ctx.lineTo(w * 2, 0)
      ctx.stroke()

      // Pitch ladder every 10°.
      ctx.fillStyle = '#FFFFFF'
      ctx.font = '10px "Roboto Mono", monospace'
      ctx.textAlign = 'center'
      for (let deg = -30; deg <= 30; deg += 10) {
        if (deg === 0) continue
        const y = -deg * 1.6
        ctx.beginPath()
        ctx.moveTo(-30, y)
        ctx.lineTo(30, y)
        ctx.stroke()
        ctx.fillText(String(Math.abs(deg)), 45, y + 3)
      }
      ctx.restore()

      // Fixed aircraft symbol: brand orange, always level.
      ctx.strokeStyle = '#F7941D'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(cx - 40, cy)
      ctx.lineTo(cx - 12, cy)
      ctx.moveTo(cx + 12, cy)
      ctx.lineTo(cx + 40, cy)
      ctx.moveTo(cx, cy - 6)
      ctx.lineTo(cx, cy)
      ctx.stroke()

      // Corner readouts.
      ctx.fillStyle = '#FFFFFF'
      ctx.font = '12px "Roboto Mono", monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`GS ${v.groundspeedMs.toFixed(1)} m/s`, 8, 16)
      ctx.fillText(`THR ${v.throttlePct.toFixed(0)}%`, 8, h - 8)
      ctx.textAlign = 'right'
      ctx.fillText(`ALT ${v.relAltM.toFixed(1)} m`, w - 8, 16)
      ctx.fillText(`HDG ${v.headingDeg.toFixed(0)}°`, w - 8, h - 8)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} className="flight-hud" />
}
