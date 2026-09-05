import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../services/telemetry-ring'
import { token } from '../theme-tokens'

// Two round instruments, drawn on canvas and driven straight from the
// telemetry rings on requestAnimationFrame -- the same reason the flight
// HUD does: attitude arrives faster than React should re-render.

function useCanvas(draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const size = canvas.clientWidth
      if (size === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr
        canvas.height = size * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      drawRef.current(ctx, size)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [])
  return ref
}

function clipCircle(ctx: CanvasRenderingContext2D, size: number) {
  const r = size / 2
  ctx.beginPath()
  ctx.arc(r, r, r - 1, 0, Math.PI * 2)
  ctx.clip()
}

export function AttitudeIndicator() {
  const ref = useCanvas((ctx, size) => {
    const r = size / 2
    const roll = telemetryRings.rollRad.latest()
    const pitch = telemetryRings.pitchRad.latest()

    ctx.save()
    clipCircle(ctx, size)
    ctx.translate(r, r)
    ctx.rotate(-roll)
    // 1.7 px per degree keeps roughly +-35 degrees of pitch in the dial.
    ctx.translate(0, ((pitch * 180) / Math.PI) * 1.7)

    // Sky and ground keep their colors in both themes: an attitude
    // indicator that went dark would stop reading as one. Only the face,
    // bezel and lettering follow the window.
    ctx.fillStyle = '#7FB2E5'
    ctx.fillRect(-size, -size * 2, size * 2, size * 2)
    ctx.fillStyle = '#9B7B4F'
    ctx.fillRect(-size, 0, size * 2, size * 2)
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(-size, 0)
    ctx.lineTo(size, 0)
    ctx.stroke()

    ctx.lineWidth = 1
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * 1.7
      const w = deg % 20 === 0 ? r * 0.36 : r * 0.2
      ctx.beginPath()
      ctx.moveTo(-w, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    ctx.restore()

    // Fixed aircraft reference, always level.
    ctx.strokeStyle = '#F7941D'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(r - r * 0.55, r)
    ctx.lineTo(r - r * 0.18, r)
    ctx.moveTo(r + r * 0.18, r)
    ctx.lineTo(r + r * 0.55, r)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(r, r, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#F7941D'
    ctx.fill()

    ctx.strokeStyle = token('--la-line-strong', '#C9CAD0')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(r, r, r - 1, 0, Math.PI * 2)
    ctx.stroke()
  })
  return <canvas ref={ref} className="instrument" role="img" aria-label="Attitude indicator" />
}

export function HeadingDial() {
  const ref = useCanvas((ctx, size) => {
    const r = size / 2
    const heading = telemetryRings.headingDeg.latest()

    ctx.fillStyle = token('--la-surface-2', '#F7F8FA')
    ctx.beginPath()
    ctx.arc(r, r, r - 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = token('--la-line-strong', '#C9CAD0')
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.save()
    ctx.translate(r, r)
    // The card turns under a fixed lubber line, as a real compass does.
    ctx.rotate((-heading * Math.PI) / 180)
    ctx.strokeStyle = token('--la-ink-3', '#82828A')
    ctx.fillStyle = token('--la-ink', '#2D2D2F')
    ctx.font = `600 ${Math.round(size * 0.13)}px "Work Sans", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg * Math.PI) / 180
      const long = deg % 90 === 0
      ctx.beginPath()
      ctx.lineWidth = long ? 1.6 : 1
      ctx.moveTo(Math.sin(a) * (r - 3), -Math.cos(a) * (r - 3))
      ctx.lineTo(Math.sin(a) * (r - (long ? 11 : 7)), -Math.cos(a) * (r - (long ? 11 : 7)))
      ctx.stroke()
      if (long) {
        const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg]!
        ctx.save()
        ctx.translate(Math.sin(a) * (r - 22), -Math.cos(a) * (r - 22))
        ctx.rotate((heading * Math.PI) / 180)
        ctx.fillText(label, 0, 0)
        ctx.restore()
      }
    }
    ctx.restore()

    // Lubber line and the numeric heading, because a dial alone is hard to
    // read to the degree.
    ctx.fillStyle = '#F7941D'
    ctx.beginPath()
    ctx.moveTo(r, 4)
    ctx.lineTo(r - 5, 13)
    ctx.lineTo(r + 5, 13)
    ctx.closePath()
    ctx.fill()

    // The number goes in the middle, the one part of the face the rotating
    // card leaves empty -- at the bottom it collided with the S and W marks.
    ctx.fillStyle = token('--la-ink', '#2D2D2F')
    ctx.font = `600 ${Math.round(size * 0.19)}px "Roboto Mono", monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${Math.round(heading)}°`, r, r)
  })
  return <canvas ref={ref} className="instrument" role="img" aria-label="Heading indicator" />
}
