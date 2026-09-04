import { useEffect, useMemo, useRef, useState } from 'react'
import { getSeries, type Series } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { useLogStore } from '../../../stores/log-store'
import { modeSpans, type ModeSpan } from '../../../protocol/log-modes'

// The time-series plot, drawn on a canvas.
//
// Canvas rather than SVG for the same reason the HUD is: a single IMU field
// from a ten-minute flight is a hundred thousand points, and that many DOM
// nodes is not a plot, it is a hang. Redrawn on change rather than per
// frame -- nothing here animates, and a log does not move.
//
// Wheel zooms about the pointer and drag pans, both on the time axis only:
// the y range is what the data is, and a plot you can lose your data off the
// top of is a plot you spend your time hunting in.

const COLORS = [
  '#F7941D',
  '#4684C5',
  '#2FAE4E',
  '#D63031',
  '#8E44AD',
  '#16A085',
  '#E67E22',
  '#2C3E50',
]

/**
 * Width of one y-axis gutter, per plotted field.
 *
 * Wide enough for the longest thing format() produces -- "2.29e-3" is
 * seven monospace characters -- plus a gap. At 46 the columns touched and
 * read as one number: "1176.0" and "2.29e-3" became "1176.02.29e-3".
 */
const AXIS_W = 58

/** Beyond this many axes there is no room left to plot in. */
const MAX_AXES = 4

const PAD = { top: 12, bottom: 26, right: 14 }

/** A series' own min and max within the visible window. */
export function rangeOf(
  s: { time: Float64Array; values: Float64Array },
  view: { t0: number; t1: number },
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < s.values.length; i++) {
    const t = s.time[i]!
    if (t < view.t0 || t > view.t1) continue
    const v = s.values[i]!
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 }
  // A constant trace still needs a band to be drawn in, or it lands on a
  // division by zero and vanishes.
  return min === max ? { min: min - 1, max: max + 1 } : { min, max }
}

/**
 * The y range each series is drawn against.
 *
 * Per field by default, the way plot.ardupilot.org does it: every trace at
 * its own scale with its own axis, so an altitude in metres and a servo
 * output in microseconds are both legible on one plot. Shared is the mode
 * for when the traces *are* comparable -- desired roll against actual roll
 * says nothing unless both are drawn against the same numbers.
 */
export function scalesFor(
  series: { time: Float64Array; values: Float64Array }[],
  view: { t0: number; t1: number },
  mode: 'perField' | 'shared',
): { min: number; max: number }[] {
  const own = series.map((s) => rangeOf(s, view))
  if (mode === 'perField') return own
  const min = Math.min(...own.map((r) => r.min))
  const max = Math.max(...own.map((r) => r.max))
  return own.map(() => (min === max ? { min: min - 1, max: max + 1 } : { min, max }))
}

export default function LogPlot() {
  const log = useLogStore((s) => s.log)
  const selected = useLogStore((s) => s.selected)
  const axisMode = useLogStore((s) => s.axisMode)
  const shadeModes = useLogStore((s) => s.shadeModes)
  const spans = useMemo(() => (log && shadeModes ? modeSpans(log) : []), [log, shadeModes])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Visible time window, or null for "all of it". */
  const [span, setSpan] = useState<{ t0: number; t1: number } | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)

  const series = useMemo(() => {
    if (!log) return []
    return selected
      .map((f) => getSeries(log, f.message, f.field))
      .filter((s): s is Series => s !== null)
  }, [log, selected])

  // Full extent of everything selected, which is what "reset zoom" means.
  const extent = useMemo(() => {
    let t0 = Infinity
    let t1 = -Infinity
    for (const s of series) {
      if (s.time.length === 0) continue
      t0 = Math.min(t0, s.time[0]!)
      t1 = Math.max(t1, s.time[s.time.length - 1]!)
    }
    return Number.isFinite(t0) ? { t0, t1 } : null
  }, [series])

  // A new selection should not stay zoomed into the old one's window.
  useEffect(() => setSpan(null), [log])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const view = span ?? extent

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size, series, view, axisMode, cursor, spans)
  }, [size, series, view, axisMode, cursor, spans])

  if (!log) return null

  const toTime = (clientX: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const left = gutter(series.length, axisMode)
    const w = size.w - left - PAD.right
    if (w <= 0) return null
    return view.t0 + ((clientX - rect.left - left) / w) * (view.t1 - view.t0)
  }

  return (
    // The wrapper and canvas are always mounted, even with nothing selected.
    // Returning a different element for the empty case left the sizing
    // observer -- which runs once, on mount -- attached to nothing, so the
    // canvas stayed zero-sized and drew nothing for the rest of the session.
    <div className="log-plot" ref={wrapRef}>
      {series.length === 0 && (
        <p className="log-plot__hint app-placeholder">
          Pick a field on the left to plot it. Fields are grouped by the message that carries
          them, and RC and servo channels are named by what they do on this aircraft.
        </p>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        onMouseMove={(e) => {
          if (dragRef.current !== null) {
            const t = toTime(e.clientX)
            if (t !== null && view) {
              const dt = dragRef.current - t
              setSpan({ t0: view.t0 + dt, t1: view.t1 + dt })
            }
            return
          }
          setCursor(toTime(e.clientX))
        }}
        onMouseLeave={() => {
          setCursor(null)
          dragRef.current = null
        }}
        onMouseDown={(e) => {
          dragRef.current = toTime(e.clientX)
        }}
        onMouseUp={() => {
          dragRef.current = null
        }}
        onWheel={(e) => {
          if (!view) return
          const at = toTime(e.clientX)
          if (at === null) return
          // Zoom about the pointer, so the thing under it stays put --
          // zooming about the centre makes you chase what you were reading.
          const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2
          const t0 = at - (at - view.t0) * factor
          const t1 = at + (view.t1 - at) * factor
          setSpan({ t0, t1 })
        }}
        onDoubleClick={() => setSpan(null)}
      />
      <Legend series={series} cursor={cursor} view={view} />
      {span && (
        <button type="button" className="log-plot__reset" onClick={() => setSpan(null)}>
          Reset zoom
        </button>
      )}
    </div>
  )
}

/** Where a drag started, in seconds. Outside state: it changes per frame. */
const dragRef = { current: null as number | null }

function Legend({
  series,
  cursor,
  view,
}: {
  series: Series[]
  cursor: number | null
  view: { t0: number; t1: number } | null
}) {
  const params = useLogStore((s) => s.log?.params)
  return (
    <div className="log-legend">
      {series.map((s, i) => {
        const named = params ? fieldLabel(params, s.message, s.field) : null
        const at = cursor !== null ? sampleAt(s, cursor) : null
        return (
          <span key={`${s.message}.${s.field}`} className="log-legend__item">
            <span className="log-legend__swatch" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="log-legend__name">
              {s.message}.{s.field}
              {/* The whole point of the labels: "RCOU.C3" means nothing,
                  "RCOU.C3 (Motor 3)" means everything. */}
              {named && <em className="log-legend__fn"> {named}</em>}
            </span>
            <span className="log-legend__value">
              {at === null ? '' : `${format(at)}${s.unit ? ` ${s.unit}` : ''}`}
            </span>
          </span>
        )
      })}
      {cursor !== null && view && <span className="log-legend__time">t = {cursor.toFixed(2)} s</span>}
    </div>
  )
}

/** Value of a series at a time, by binary search. Null outside its range. */
function sampleAt(s: Series, t: number): number | null {
  const time = s.time
  if (time.length === 0 || t < time[0]! || t > time[time.length - 1]!) return null
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (time[mid]! <= t) lo = mid
    else hi = mid
  }
  return s.values[lo] ?? null
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 10000 || (abs < 0.01 && abs > 0)) return v.toExponential(2)
  return v.toFixed(abs >= 100 ? 1 : 3)
}

/** How much room the y axes need on the left. */
function gutter(count: number, mode: 'perField' | 'shared'): number {
  if (mode === 'shared') return AXIS_W + 12
  return Math.max(1, Math.min(count, MAX_AXES)) * AXIS_W + 12
}

function draw(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  series: Series[],
  view: { t0: number; t1: number } | null,
  axisMode: 'perField' | 'shared',
  cursor: number | null,
  spans: ModeSpan[],
) {
  const style = getComputedStyle(document.documentElement)
  const ink = style.getPropertyValue('--la-ink-2').trim() || '#555'
  const faint = style.getPropertyValue('--la-ink-3').trim() || '#888'
  const grid = style.getPropertyValue('--la-line').trim() || '#ddd'
  const surface = style.getPropertyValue('--la-surface').trim() || '#fff'

  ctx.fillStyle = surface
  ctx.fillRect(0, 0, size.w, size.h)
  if (!view || view.t1 <= view.t0) return

  const left = gutter(series.length, axisMode)
  const plotW = size.w - left - PAD.right
  const plotH = size.h - PAD.top - PAD.bottom
  if (plotW <= 0 || plotH <= 0) return

  const scales = scalesFor(series, view, axisMode)
  const xOf = (t: number) => left + ((t - view.t0) / (view.t1 - view.t0)) * plotW
  const yOf = (v: number, idx: number) => {
    const r = scales[idx] ?? { min: 0, max: 1 }
    return PAD.top + plotH - ((v - r.min) / (r.max - r.min)) * plotH
  }

  ctx.font = '11px "Roboto Mono", monospace'

  // Flight modes first, behind everything: the context a trace is read in.
  if (spans.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, PAD.top, plotW, plotH)
    ctx.clip()
    spans.forEach((span, i) => {
      const x0 = xOf(Math.max(span.from, view.t0))
      const x1 = xOf(Math.min(span.to, view.t1))
      if (x1 <= x0) return
      // Alternating tints of one hue rather than a color per mode: the
      // label says which mode it is, and a rainbow behind the data would
      // compete with the traces it exists to give context to.
      ctx.fillStyle = i % 2 === 0 ? 'rgba(70, 132, 197, 0.09)' : 'rgba(70, 132, 197, 0.04)'
      ctx.fillRect(x0, PAD.top, x1 - x0, plotH)
      ctx.strokeStyle = grid
      ctx.beginPath()
      ctx.moveTo(Math.round(x0) + 0.5, PAD.top)
      ctx.lineTo(Math.round(x0) + 0.5, PAD.top + plotH)
      ctx.stroke()
      // Only label a band wide enough to hold the name.
      const width = ctx.measureText(span.name).width
      if (x1 - x0 > width + 10) {
        ctx.fillStyle = faint
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(span.name, x0 + 5, PAD.top + 3)
      }
    })
    ctx.restore()
  }

  // Horizontal grid, and one y axis per series (or one shared).
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(left, Math.round(y) + 0.5)
    ctx.lineTo(size.w - PAD.right, Math.round(y) + 0.5)
    ctx.stroke()
  }

  const axes = axisMode === 'shared' ? series.slice(0, 1) : series.slice(0, MAX_AXES)
  axes.forEach((_, idx) => {
    const r = scales[idx] ?? { min: 0, max: 1 }
    // Each axis in its trace's color, which is the only thing tying the
    // numbers to the line they belong to.
    ctx.fillStyle = axisMode === 'shared' ? ink : COLORS[idx % COLORS.length]!
    ctx.textAlign = 'right'
    const x = (idx + 1) * AXIS_W + 4
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH * i) / 4
      ctx.fillText(format(r.max - ((r.max - r.min) * i) / 4), x, y)
    }
  })

  // Time axis.
  ctx.strokeStyle = grid
  ctx.fillStyle = ink
  ctx.textBaseline = 'top'
  for (let i = 0; i <= 5; i++) {
    const x = left + (plotW * i) / 5
    ctx.beginPath()
    ctx.moveTo(Math.round(x) + 0.5, PAD.top)
    ctx.lineTo(Math.round(x) + 0.5, PAD.top + plotH)
    ctx.stroke()
    const t = view.t0 + ((view.t1 - view.t0) * i) / 5
    // The end labels would otherwise print half off the canvas.
    ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center'
    ctx.fillText(`${t.toFixed(1)}s`, x, PAD.top + plotH + 6)
  }

  // The traces, clipped so a pan cannot draw over the axes.
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, PAD.top, plotW, plotH)
  ctx.clip()
  series.forEach((s, idx) => {
    ctx.strokeStyle = COLORS[idx % COLORS.length]!
    ctx.lineWidth = 1.4
    ctx.beginPath()
    // At most one segment per pixel column: a log has far more samples than
    // the canvas has columns, and drawing them all repaints the same pixel.
    const step = Math.max(1, Math.floor(s.values.length / (plotW * 2)))
    let started = false
    for (let i = 0; i < s.values.length; i += step) {
      const t = s.time[i]!
      if (t < view.t0 || t > view.t1) {
        started = false
        continue
      }
      const x = xOf(t)
      const y = yOf(s.values[i]!, idx)
      if (started) ctx.lineTo(x, y)
      else {
        ctx.moveTo(x, y)
        started = true
      }
    }
    ctx.stroke()
  })
  ctx.restore()

  if (cursor !== null && cursor >= view.t0 && cursor <= view.t1) {
    ctx.strokeStyle = ink
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    const x = Math.round(xOf(cursor)) + 0.5
    ctx.moveTo(x, PAD.top)
    ctx.lineTo(x, PAD.top + plotH)
    ctx.stroke()
    ctx.setLineDash([])
  }
}
