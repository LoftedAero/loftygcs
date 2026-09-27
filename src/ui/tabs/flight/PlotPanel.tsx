import { useEffect, useRef } from 'react'
import { LaButton } from '../../components/La'
import { fieldRegistry } from '../../../services/telemetry-fields'
import { token } from '../../theme-tokens'

// A live strip chart of whatever fields are selected.
//
// Drawn on a canvas on requestAnimationFrame, like the HUD, because samples
// arrive faster than React should re-render.
//
// Each series is scaled to its own range, so battery voltage and motor RPM
// are both legible; the legend carries the numbers.

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

/** Room for the value labels down the left and the times along the bottom. */
const GUTTER_L = 52
const GUTTER_B = 18
const PAD_T = 8
const PAD_R = 10

export interface PlotPanelProps {
  fields: readonly string[]
  /** Which series the Y axis numbers belong to. */
  axisField: string | null
  onAxisField: (name: string) => void
  onRemove: (name: string) => void
  onPick: () => void
  onClose: () => void
}

export default function PlotPanel({
  fields,
  axisField,
  onAxisField,
  onRemove,
  onPick,
  onClose,
}: PlotPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  // Every series has its own scale, so only one owns the Y axis numbers.
  const axisRefName = useRef(axisField)
  axisRefName.current = axisField

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
      // The window grows with the available history, up to a minute, so a
      // new plot is not mostly blank.
      let earliest = now
      for (const name of fieldsRef.current) {
        const s = fieldRegistry.samples(name)
        if (s && s.t.length > 0) earliest = Math.min(earliest, s.t[0]!)
      }
      const span = Math.max(5000, Math.min(WINDOW_MS, now - earliest))
      const from = now - span

      // The plotting area, inside the label gutters.
      const px = GUTTER_L
      const py = PAD_T
      const pw = Math.max(10, w - GUTTER_L - PAD_R)
      const ph = Math.max(10, h - PAD_T - GUTTER_B)
      const xAt = (t: number) => px + ((t - from) / span) * pw

      // Grid and label colors follow the theme; the series colors read on
      // both.
      const gridColor = token('--la-line', '#E1E2E6')
      const labelColor = token('--la-ink-3', '#82828A')

      ctx.font = '10px "Roboto Mono", ui-monospace, monospace'
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1

      // Y grid. Its labels are drawn after the series, once the owning
      // series' range is known.
      const yRows = 4
      for (let i = 0; i <= yRows; i++) {
        const y = Math.round(py + (ph / yRows) * i) + 0.5
        ctx.beginPath()
        ctx.moveTo(px, y)
        ctx.lineTo(px + pw, y)
        ctx.stroke()
      }

      // X grid, labeled in seconds back from now.
      const step = span > 40000 ? 15 : span > 20000 ? 10 : 5
      ctx.fillStyle = labelColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let sec = 0; sec <= span / 1000; sec += step) {
        const x = Math.round(xAt(now - sec * 1000)) + 0.5
        if (x < px - 1) continue
        ctx.beginPath()
        ctx.moveTo(x, py)
        ctx.lineTo(x, py + ph)
        ctx.stroke()
        ctx.fillText(sec === 0 ? 'now' : `-${sec}s`, x, py + ph + 4)
      }

      const legend: { name: string; color: string; value: number; lo: number; hi: number }[] = []
      fieldsRef.current.forEach((name, i) => {
        const s = fieldRegistry.samples(name)
        const color = PLOT_COLORS[i % PLOT_COLORS.length]!
        if (!s || s.t.length === 0) return

        // Range over the visible window only, so a spike that has scrolled
        // off no longer flattens the rest.
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

        ctx.save()
        ctx.beginPath()
        ctx.rect(px, py, pw, ph)
        ctx.clip()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.6
        ctx.lineJoin = 'round'
        ctx.beginPath()
        let started = false
        for (let k = 0; k < s.t.length; k++) {
          const tk = s.t[k]!
          if (tk < from) continue
          const x = xAt(tk)
          const y = py + (1 - (s.v[k]! - lo) / (hi - lo)) * ph
          if (started) ctx.lineTo(x, y)
          else {
            ctx.moveTo(x, y)
            started = true
          }
        }
        ctx.stroke()
        ctx.restore()
        legend.push({ name, color, value: s.v[s.t.length - 1] ?? 0, lo, hi })
      })

      // Y labels, in the owning series' color.
      const owner = legend.find((e) => e.name === axisRefName.current) ?? legend[0]
      if (owner) {
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = owner.color
        for (let i = 0; i <= yRows; i++) {
          const y = py + (ph / yRows) * i
          const value = owner.hi - ((owner.hi - owner.lo) / yRows) * i
          ctx.fillText(fmt(value), px - 6, y)
        }
      }

      // The legend is DOM so its buttons are real controls; its values are
      // updated here to stay in step with the lines.
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
          {fields.map((name, i) => {
            const owns = (axisField ?? fields[0]) === name
            return (
              <span
                key={name}
                className={`plot-chip${owns ? ' is-axis' : ''}`}
                data-field={name}
                style={{ borderLeftColor: PLOT_COLORS[i % PLOT_COLORS.length] }}
              >
                {/* Clicking a chip gives it the Y axis. */}
                <button
                  type="button"
                  className="plot-chip__pick"
                  aria-pressed={owns}
                  title={owns ? 'The Y axis shows this series' : 'Show this series on the Y axis'}
                  onClick={() => onAxisField(name)}
                >
                  <span className="plot-chip__name">{name}</span>
                  <span className="plot-chip__value">—</span>
                  <span className="plot-chip__range">—</span>
                </button>
                <button
                  type="button"
                  className="plot-chip__remove"
                  aria-label={`Stop plotting ${name}`}
                  onClick={() => onRemove(name)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
        <LaButton variant="secondary" size="sm" onClick={onPick}>
          Add field
        </LaButton>
        <button
          type="button"
          className="plot-panel__close"
          aria-label="Close the plot"
          title="Close the plot"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <canvas ref={canvasRef} className="plot-panel__canvas" />
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
