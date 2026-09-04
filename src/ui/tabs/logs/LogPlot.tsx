import { useEffect, useMemo, useRef, useState } from 'react'
import { getSeries, type Series } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { MAX_AXES, traceColor, useLogStore } from '../../../stores/log-store'
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

/**
 * Width of one y-axis gutter, per plotted field.
 *
 * Wide enough for the longest thing format() produces -- "2.29e-3" is
 * seven monospace characters -- plus a gap. At 46 the columns touched and
 * read as one number: "1176.0" and "2.29e-3" became "1176.02.29e-3".
 */
const AXIS_W = 58

const PAD = { top: 26, bottom: 26, right: 14 }

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
 * The y range each *axis* is drawn against.
 *
 * An axis spans everything assigned to it, so two traces sharing one are
 * directly comparable -- which is the whole reason to put them together.
 * Axes nobody is using get no range and no gutter.
 */
export function axisRanges(
  series: readonly { time: Float64Array; values: Float64Array; axis: number }[],
  view: { t0: number; t1: number },
): Map<number, { min: number; max: number }> {
  const out = new Map<number, { min: number; max: number }>()
  for (const s of series) {
    const r = rangeOf(s, view)
    const have = out.get(s.axis)
    out.set(
      s.axis,
      have ? { min: Math.min(have.min, r.min), max: Math.max(have.max, r.max) } : r,
    )
  }
  for (const [axis, r] of out) {
    if (r.min === r.max) out.set(axis, { min: r.min - 1, max: r.max + 1 })
  }
  return out
}

/** Axes with something on them, in drawing order. */
export function usedAxes(series: readonly { axis: number }[]): number[] {
  return [...new Set(series.map((s) => s.axis))].sort((a, b) => a - b)
}

export default function LogPlot() {
  const log = useLogStore((s) => s.log)
  const selected = useLogStore((s) => s.selected)
  const shadeModes = useLogStore((s) => s.shadeModes)
  const playhead = useLogStore((s) => s.playhead)
  const requestSeek = useLogStore((s) => s.requestSeek)
  const spans = useMemo(() => (log && shadeModes ? modeSpans(log) : []), [log, shadeModes])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const span = useLogStore((s) => s.timeWindow)
  const setSpan = useLogStore((s) => s.setTimeWindow)
  const [cursor, setCursor] = useState<number | null>(null)
  /** Where a box-zoom drag started, and where it is now, in seconds. */
  const [box, setBox] = useState<{ from: number; to: number } | null>(null)

  const series = useMemo(() => {
    if (!log) return []
    return selected
      .map((f, i) => {
        const s = getSeries(log, f.message, f.field)
        return s ? { ...s, axis: f.axis, color: traceColor(f, i) } : null
      })
      .filter((s): s is PlottedSeries => s !== null)
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
    draw(ctx, size, series, view, cursor, spans, box, playhead)
  }, [size, series, view, cursor, spans, box, playhead])

  if (!log) return null

  const toTime = (clientX: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const left = gutter(usedAxes(series).length)
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
          const t = toTime(e.clientX)
          if (panRef.current !== null) {
            if (t !== null && view) {
              const dt = panRef.current - t
              setSpan({ t0: view.t0 + dt, t1: view.t1 + dt })
            }
            return
          }
          if (boxRef.current !== null && t !== null) {
            setBox({ from: boxRef.current, to: t })
            setCursor(null)
            return
          }
          setCursor(t)
        }}
        onMouseLeave={() => {
          setCursor(null)
          panRef.current = null
          boxRef.current = null
          setBox(null)
        }}
        onMouseDown={(e) => {
          const t = toTime(e.clientX)
          // Shift pans, plain drag boxes. Zooming is the thing done most
          // often on a log, so it gets the unmodified gesture.
          if (e.shiftKey) panRef.current = t
          else boxRef.current = t
        }}
        onMouseUp={(e) => {
          panRef.current = null
          const start = boxRef.current
          boxRef.current = null
          setBox(null)
          if (start === null) return
          const end = toTime(e.clientX)
          if (end === null) return
          // A click is not a zoom. Below a few pixels it was someone
          // pointing at the trace, and zooming to a sliver of a second
          // would be a nasty surprise.
          const width = Math.abs(end - start)
          // Too small to be a zoom, so it was a click: send the replay to
          // that instant instead. One gesture, two readings -- what the
          // trace says there and where the aircraft was.
          if (!view || width < (view.t1 - view.t0) / 200) {
            requestSeek(end)
            return
          }
          setSpan({ t0: Math.min(start, end), t1: Math.max(start, end) })
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

// Where each kind of drag began, in seconds. Outside React state because
// they change on every pointer event and nothing renders from them.
const panRef = { current: null as number | null }
const boxRef = { current: null as number | null }

/** A series with the axis and color it was assigned. */
export type PlottedSeries = Series & { axis: number; color: string }

function Legend({
  series,
  cursor,
  view,
}: {
  series: PlottedSeries[]
  cursor: number | null
  view: { t0: number; t1: number } | null
}) {
  const params = useLogStore((s) => s.log?.params)
  return (
    <div className="log-legend">
      {series.map((s) => {
        const named = params ? fieldLabel(params, s.message, s.field) : null
        const at = cursor !== null ? sampleAt(s, cursor) : null
        return (
          <span key={`${s.message}.${s.field}`} className="log-legend__item">
            <span className="log-legend__swatch" style={{ background: s.color }} />
            <span className="log-legend__axis">Y{s.axis + 1}</span>
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
function gutter(count: number): number {
  return Math.max(1, Math.min(count, MAX_AXES)) * AXIS_W + 12
}

function draw(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  series: PlottedSeries[],
  view: { t0: number; t1: number } | null,
  cursor: number | null,
  spans: ModeSpan[],
  box: { from: number; to: number } | null,
  playhead: number | null,
) {
  const style = getComputedStyle(document.documentElement)
  const ink = style.getPropertyValue('--la-ink-2').trim() || '#555'
  const faint = style.getPropertyValue('--la-ink-3').trim() || '#888'
  const grid = style.getPropertyValue('--la-line').trim() || '#ddd'
  const surface = style.getPropertyValue('--la-surface').trim() || '#fff'

  ctx.fillStyle = surface
  ctx.fillRect(0, 0, size.w, size.h)
  if (!view || view.t1 <= view.t0) return

  const axes = usedAxes(series)
  const left = gutter(axes.length)
  const plotW = size.w - left - PAD.right
  const plotH = size.h - PAD.top - PAD.bottom
  if (plotW <= 0 || plotH <= 0) return

  const ranges = axisRanges(series, view)
  const xOf = (t: number) => left + ((t - view.t0) / (view.t1 - view.t0)) * plotW
  const yOf = (v: number, axis: number) => {
    const r = ranges.get(axis) ?? { min: 0, max: 1 }
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

  axes.forEach((axis, column) => {
    const r = ranges.get(axis) ?? { min: 0, max: 1 }
    const on = series.filter((s) => s.axis === axis)
    // An axis carrying one trace takes that trace's color, which is what
    // ties the numbers to the line. An axis shared by several has no one
    // color to borrow, so it stays neutral and the legend does the tying.
    ctx.fillStyle = on.length === 1 ? on[0]!.color : ink
    ctx.textAlign = 'right'
    const x = (column + 1) * AXIS_W + 4
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (plotH * i) / 4
      ctx.fillText(format(r.max - ((r.max - r.min) * i) / 4), x, y)
    }
    // The unit at the head of its column: without it the numbers on a
    // three-axis plot are three columns of digits meaning nothing.
    const units = [...new Set(on.map((t) => t.unit).filter(Boolean))]
    if (units.length > 0) {
      // At the very top of the canvas, clear of the topmost tick: both are
      // right-aligned to the same edge, so anything closer overlaps it.
      ctx.textBaseline = 'top'
      ctx.fillText(units.length === 1 ? units[0]! : 'mixed', x, 2)
      ctx.textBaseline = 'middle'
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
  series.forEach((s) => {
    ctx.strokeStyle = s.color
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
      const y = yOf(s.values[i]!, s.axis)
      if (started) ctx.lineTo(x, y)
      else {
        ctx.moveTo(x, y)
        started = true
      }
    }
    ctx.stroke()
  })
  ctx.restore()

  // The zoom box, over everything so it is visible against any trace.
  if (box && box.from !== box.to) {
    const x0 = xOf(Math.min(box.from, box.to))
    const x1 = xOf(Math.max(box.from, box.to))
    ctx.fillStyle = 'rgba(70, 132, 197, 0.18)'
    ctx.fillRect(x0, PAD.top, x1 - x0, plotH)
    ctx.strokeStyle = '#4684C5'
    ctx.beginPath()
    ctx.moveTo(Math.round(x0) + 0.5, PAD.top)
    ctx.lineTo(Math.round(x0) + 0.5, PAD.top + plotH)
    ctx.moveTo(Math.round(x1) + 0.5, PAD.top)
    ctx.lineTo(Math.round(x1) + 0.5, PAD.top + plotH)
    ctx.stroke()
    // How long the selection is, which is the number being chosen.
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${Math.abs(box.to - box.from).toFixed(2)} s`, (x0 + x1) / 2, PAD.top + 4)
    ctx.textBaseline = 'middle'
  }

  // Where the 3D replay has got to: solid, charcoal, with a marker at the
  // top. Not orange -- that is the first trace colour, and a playhead the
  // same colour as the line it crosses disappears into it.
  if (playhead !== null && playhead >= view.t0 && playhead <= view.t1) {
    const x = Math.round(xOf(playhead)) + 0.5
    ctx.strokeStyle = '#2D2D2F'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, PAD.top)
    ctx.lineTo(x, PAD.top + plotH)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.fillStyle = '#2D2D2F'
    ctx.beginPath()
    ctx.moveTo(x - 4, PAD.top)
    ctx.lineTo(x + 4, PAD.top)
    ctx.lineTo(x, PAD.top + 6)
    ctx.closePath()
    ctx.fill()
  }

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
