import { useEffect, useRef } from 'react'
import { useUnits } from '../../../stores/preferences-store'
import { distanceLabel, toDistance } from '../../../units'
import { useMissionStore } from '../../../stores/mission-store'
import { legStats, hasCoords } from '../../../protocol/mission-plan'
import { commandSpec } from '../../../protocol/mission-commands'
import { token } from '../../theme-tokens'
import { useThemeStore } from '../../../stores/theme-store'

// QGroundControl's altitude profile: the mission seen from the side, with
// distance along the bottom and height up the left.
//
// It answers the question a map cannot -- does this mission fly into the
// hill, or descend when it should climb -- and it answers it at a glance,
// which is why it is worth a strip of screen. Canvas rather than SVG so the
// terrain line can be added later without the DOM growing a node per sample.
//
// Only items with an altitude appear. A DO_SET_SERVO has no height, and
// inventing one for it would draw a mission that does not exist.

// Top padding leaves room for the sequence number drawn above each marker;
// at 12 the highest waypoint's label was clipped by the canvas edge.
const PAD = { left: 44, right: 16, top: 22, bottom: 22 }

export default function AltitudeProfile() {
  const theme = useThemeStore((s) => s.resolved)
  const units = useUnits()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const plan = useMissionStore((s) => s.plan)
  const selected = useMissionStore((s) => s.selected)
  const select = useMissionStore((s) => s.select)

  // Points are needed by both the painter and the click handler, so they are
  // computed once per render and read from a ref inside the canvas listener.
  const pointsRef = useRef<{ uid: string; x: number; y: number }[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w === 0 || h === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const ink = token('--la-ink-2', '#55555B')
      const line = token('--la-line', '#E1E2E6')
      const accent = token('--la-orange', '#F7941D')
      const blue = token('--la-blue', '#4684C5')

      const stats = legStats(plan)
      const pts = plan.items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => commandSpec(it.command)?.altitude !== false)
        .map(({ it, i }) => ({
          uid: it.uid,
          d: stats[i]?.totalM ?? 0,
          z: it.z,
          seq: i + 1,
          located: hasCoords(it),
        }))

      const plotW = w - PAD.left - PAD.right
      const plotH = h - PAD.top - PAD.bottom
      if (plotW < 20 || plotH < 20) return

      const maxD = Math.max(1, ...pts.map((p) => p.d))
      const maxZ = Math.max(10, ...pts.map((p) => p.z))
      const minZ = Math.min(0, ...pts.map((p) => p.z))
      const zRange = Math.max(1, maxZ - minZ)
      const sx = (d: number) => PAD.left + (d / maxD) * plotW
      const sy = (z: number) => PAD.top + plotH - ((z - minZ) / zRange) * plotH

      // Ground line and axes.
      ctx.strokeStyle = line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.left, PAD.top)
      ctx.lineTo(PAD.left, PAD.top + plotH)
      ctx.lineTo(PAD.left + plotW, PAD.top + plotH)
      ctx.stroke()

      ctx.fillStyle = ink
      ctx.font = '11px "Roboto Mono", monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const frac of [0, 0.5, 1]) {
        const z = minZ + zRange * frac
        const y = sy(z)
        ctx.fillText(`${Math.round(z)}`, PAD.left - 6, y)
        if (frac > 0) {
          ctx.strokeStyle = line
          ctx.setLineDash([2, 4])
          ctx.beginPath()
          ctx.moveTo(PAD.left, y)
          ctx.lineTo(PAD.left + plotW, y)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
      ctx.textAlign = 'left'
      ctx.fillText(distanceLabel(units.distance), 6, PAD.top)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(
        `${Math.round(toDistance(maxD, units.distance))} ${distanceLabel(units.distance)}`,
        PAD.left + plotW,
        PAD.top + plotH + 5,
      )

      if (pts.length === 0) {
        pointsRef.current = []
        return
      }

      // The flown profile.
      ctx.strokeStyle = accent
      ctx.lineWidth = 2
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = sx(p.d)
        const y = sy(p.z)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Markers, numbered to match the map and the table.
      const points: { uid: string; x: number; y: number }[] = []
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (const p of pts) {
        const x = sx(p.d)
        const y = sy(p.z)
        points.push({ uid: p.uid, x, y })
        ctx.fillStyle = p.uid === selected ? accent : blue
        ctx.beginPath()
        ctx.arc(x, y, p.uid === selected ? 6 : 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = ink
        ctx.fillText(String(p.seq), x, y - 8)
      }
      pointsRef.current = points
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
    // See LogPlot: the palette is read inside the draw, so the theme has
    // to be a dependency or the canvas keeps its last paint.
  }, [plan, selected, theme, units])

  return (
    <canvas
      ref={canvasRef}
      className="mission-profile"
      aria-label="Mission altitude profile"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        let best: { uid: string; d: number } | null = null
        for (const p of pointsRef.current) {
          const d = Math.hypot(p.x - x, p.y - y)
          if (d < 14 && (!best || d < best.d)) best = { uid: p.uid, d }
        }
        if (best) select(best.uid)
      }}
    />
  )
}
