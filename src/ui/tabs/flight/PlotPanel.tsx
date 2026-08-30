import { useEffect, useRef } from 'react'
import { LaButton } from '../../components/La'
import { fieldRegistry } from '../../../services/telemetry-fields'

// A live strip chart of whatever fields are selected.
//
// Drawn on a canvas from the field registry on requestAnimationFrame, for the
// same reason the HUD is: the samples arrive faster than React should be
// asked to re-render, and a chart that stutters is worse than no chart.
//
// Each series is scaled to its own range rather than sharing one axis. Plot
// battery voltage against motor RPM on a shared axis and the voltage is a
// flat line at the bottom of the frame; scaled separately, both are legible,
// and the legend carries the numbers that give the shape meaning.

/** How much history to show. The registry holds about ninety seconds. */
const WINDOW_MS = 60_000

export const PLOT_COLORS = [
  '#4684C5',
  '#F7941D',
  '#35D07F',
  '#C05AC0',
  '#E0C020',
  '#4BC5C5',
] as const

export interface PlotPanelProps {
  fields: readonly string[]
  onRemove: (name: string) => void
  onPick: () => void
}

export default function PlotPanel({ fields, onRemove, onPick }: PlotPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const axisRef = useRef<HTMLParagraphElement>(null)
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

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
      ctx.clearRect(0, 0, w, h)

      const now = Date.now()
      // The window grows to fit what there is, up to a minute. Fixed at a
      // minute from the start, a plot opened after twenty seconds of flight
      // draws its lines in the right-hand third and leaves the rest blank,
      // which reads as broken rather than as "not enough history yet".
      let earliest = now
      for (const name of fieldsRef.current) {
        const s = fieldRegistry.samples(name)
        if (s && s.t.length > 0) earliest = Math.min(earliest, s.t[0]!)
      }
      const span = Math.max(5000, Math.min(WINDOW_MS, now - earliest))
      const from = now - span
      const pad = 6

      // Grid: a few horizontal rules and a mark every ten seconds, enough to
      // judge rate of change without turning the panel into graph paper.
      ctx.strokeStyle = 'rgba(45, 45, 47, 0.10)'
      ctx.lineWidth = 1
      for (let i = 1; i < 4; i++) {
        const y = Math.round((h / 4) * i) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      const gridStep = span > 30000 ? 10 : 5
      for (let sec = gridStep; sec < span / 1000; sec += gridStep) {
        const x = Math.round(w - (sec / (span / 1000)) * w) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // Written here rather than through React: it changes every frame while
      // history is still building up.
      const axis = axisRef.current
      if (axis) {
        axis.textContent = `last ${Math.round(span / 1000)}s · each series scaled to its own range`
      }

      const legend: { name: string; color: string; value: number; lo: number; hi: number }[] = []
      fieldsRef.current.forEach((name, i) => {
        const s = fieldRegistry.samples(name)
        const color = PLOT_COLORS[i % PLOT_COLORS.length]!
        if (!s || s.t.length === 0) return

        // Range over the visible window only, so a spike that has scrolled
        // off no longer flattens everything that is still on screen.
        let lo = Infinity
        let hi = -Infinity
        for (let k = 0; k < s.t.length; k++) {
          const tk = s.t[k]!
          if (tk < from) continue
          const vk = s.v[k]!
          if (vk < lo) lo = vk
          if (vk > hi) hi = vk
        }
        if (!Number.isFinite(lo)) return
        // A dead-flat series would divide by zero; give it a band to sit in.
        if (hi - lo < 1e-9) {
          lo -= 0.5
          hi += 0.5
        }

        ctx.strokeStyle = color
        ctx.lineWidth = 1.6
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let started = false
        for (let k = 0; k < s.t.length; k++) {
          const tk = s.t[k]!
          if (tk < from) continue
          const x = w - ((now - tk) / span) * w
          const y = pad + (1 - (s.v[k]! - lo) / (hi - lo)) * (h - pad * 2)
          if (started) ctx.lineTo(x, y)
          else {
            ctx.moveTo(x, y)
            started = true
          }
        }
        ctx.stroke()
        legend.push({ name, color, value: s.v[s.t.length - 1] ?? 0, lo, hi })
      })

      // The legend is DOM rather than canvas so the remove buttons are real
      // controls; it is updated here to stay in step with the lines.
      const box = legendRef.current
      if (box) {
        for (const entry of legend) {
          const el = box.querySelector<HTMLElement>(`[data-field="${cssEscape(entry.name)}"]`)
          const val = el?.querySelector<HTMLElement>('.plot-chip__value')
          if (val) val.textContent = fmt(entry.value)
          const range = el?.querySelector<HTMLElement>('.plot-chip__range')
          if (range) range.textContent = `${fmt(entry.lo)}…${fmt(entry.hi)}`
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="plot-panel">
      <div className="plot-panel__head">
        <div className="plot-legend" ref={legendRef}>
          {fields.map((name, i) => (
            <span
              key={name}
              className="plot-chip"
              data-field={name}
              style={{ borderLeftColor: PLOT_COLORS[i % PLOT_COLORS.length] }}
            >
              <span className="plot-chip__name">{name}</span>
              <span className="plot-chip__value">—</span>
              <span className="plot-chip__range">—</span>
              <button
                type="button"
                className="plot-chip__remove"
                aria-label={`Stop plotting ${name}`}
                onClick={() => onRemove(name)}
              >
                ×
              </button>
            </span>
          ))}
          {fields.length === 0 && (
            <span className="plot-panel__empty">
              Nothing plotted. Pick a field, or click one in the Status list.
            </span>
          )}
        </div>
        <LaButton variant="secondary" size="sm" onClick={onPick}>
          Add field…
        </LaButton>
      </div>
      <canvas ref={canvasRef} className="plot-panel__canvas" />
      <p className="plot-panel__axis" ref={axisRef}>each series scaled to its own range</p>
    </div>
  )
}

/** Field names contain dots, which are selector syntax. */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toFixed(0)
  if (abs >= 1) return v.toFixed(2)
  return v.toFixed(4)
}
