import { useEffect, useMemo, useRef, useState } from 'react'
import { getSeries, type Series } from '../../../protocol/dataflash'
import { fieldLabel } from '../../../protocol/log-labels'
import { useLogStore } from '../../../stores/log-store'

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

const PAD = { left: 58, right: 58, top: 12, bottom: 26 }

/**
 * Group the selected series by unit, and give each group its own y range.
 *
 * A shared axis is the truthful view only while everything on it is
 * measured in the same thing. Put an altitude in metres beside a servo
 * output in microseconds and the altitude becomes a flat line along the
 * bottom -- which is what this plot did until it grouped.
 *
 * Two groups get real axes, left and right. Beyond two there is nowhere
 * left to put an axis, so every group is scaled to its own range and the
 * legend says so: at that point only the shapes are comparable anyway.
 */
export interface AxisGroup {
  unit: string
  min: number
  max: number
  /** Indices into the series array. */
  members: number[]
}

export function groupByUnit(
  series: { unit: string; time: Float64Array; values: Float64Array }[],
  view: { t0: number; t1: number },
): AxisGroup[] {
  const groups = new Map<string, AxisGroup>()
  series.forEach((s, idx) => {
    let g = groups.get(s.unit)
    if (!g) {
      g = { unit: s.unit, min: Infinity, max: -Infinity, members: [] }
      groups.set(s.unit, g)
    }
    g.members.push(idx)
    for (let i = 0; i < s.values.length; i++) {
      const t = s.time[i]!
      if (t < view.t0 || t > view.t1) continue
      const v = s.values[i]!
      if (v < g.min) g.min = v
      if (v > g.max) g.max = v
    }
  })
  for (const g of groups.values()) {
    if (!Number.isFinite(g.min)) {
      g.min = 0
      g.max = 1
    }
    if (g.min === g.max) {
      // A constant trace still needs a band to be drawn in, or it lands on
      // a division by zero and disappears.
      g.min -= 1
      g.max += 1
    }
  }
  return [...groups.values()]
}

export default function LogPlot() {
  const log = useLogStore((s) => s.log)
  const selected = useLogStore((s) => s.selected)
  const normalize = useLogStore((s) => s.normalize)
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
    draw(ctx, size, series, view, normalize, cursor)
  }, [size, series, view, normalize, cursor])

  if (!log) return null
  if (series.length === 0) {
    return (
      <div className="log-plot log-plot--empty">
        <p className="app-placeholder">
          Pick a field on the right to plot it. Fields are grouped by the message that carries
          them, and RC and servo channels are named by what they do on this aircraft.
        </p>
      </div>
    )
  }

  const toTime = (clientX: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const w = size.w - PAD.left - PAD.right
    if (w <= 0) return null
    return view.t0 + ((x - PAD.left) / w) * (view.t1 - view.t0)
  }

  return (
    <div className="log-plot" ref={wrapRef}>
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

/** A series' own min and max within the visible window. */
function rangeOf(
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
  return min === max ? { min: min - 1, max: max + 1 } : { min, max }
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

function draw(
  ctx: CanvasRenderingContext2D,
  size: { w: number; h: number },
  series: Series[],
  view: { t0: number; t1: number } | null,
  normalize: boolean,
  cursor: number | null,
) {
  const style = getComputedStyle(document.documentElement)
  const ink = style.getPropertyValue('--la-ink-2').trim() || '#555'
  const grid = style.getPropertyValue('--la-line').trim() || '#ddd'
  const surface = style.getPropertyValue('--la-surface').trim() || '#fff'

  ctx.fillStyle = surface
  ctx.fillRect(0, 0, size.w, size.h)
  if (!view || view.t1 <= view.t0) return

  const plotW = size.w - PAD.left - PAD.right
  const plotH = size.h - PAD.top - PAD.bottom
  if (plotW <= 0 || plotH <= 0) return

  // Series are grouped by unit; each group gets its own range. Normalizing
  // collapses every group to 0..1, which is also what happens on its own
  // once there are more units than there are sides to hang an axis on.
  const groups = groupByUnit(series, view)
  const autoNormalize = groups.length > 2
  const perSeriesRange = new Map<number, { min: number; max: number }>()
  for (const g of groups) {
    for (const m of g.members) {
      perSeriesRange.set(m, normalize ? rangeOf(series[m]!, view) : { min: g.min, max: g.max })
    }
  }
  if (autoNormalize && !normalize) {
    for (const g of groups) {
      for (const m of g.members) perSeriesRange.set(m, { min: g.min, max: g.max })
    }
  }

  const xOf = (t: number) => PAD.left + ((t - view.t0) / (view.t1 - view.t0)) * plotW
  const yOf = (v: number, idx: number) => {
    const r = perSeriesRange.get(idx) ?? { min: 0, max: 1 }
    return PAD.top + plotH - ((v - r.min) / (r.max - r.min)) * plotH
  }

  // Grid and axis labels.
  ctx.strokeStyle = grid
  ctx.fillStyle = ink
  ctx.lineWidth = 1
  ctx.font = '11px "Roboto Mono", monospace'
  ctx.textBaseline = 'middle'
  const left = groups[0]
  const right = groups.length === 2 ? groups[1] : undefined
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(PAD.left, Math.round(y) + 0.5)
    ctx.lineTo(size.w - PAD.right, Math.round(y) + 0.5)
    ctx.stroke()
    if (normalize || autoNormalize) continue
    if (left) {
      ctx.textAlign = 'right'
      ctx.fillText(format(left.max - ((left.max - left.min) * i) / 4), PAD.left - 6, y)
    }
    if (right) {
      ctx.textAlign = 'left'
      ctx.fillText(format(right.max - ((right.max - right.min) * i) / 4), size.w - PAD.right + 6, y)
    }
  }
  // Say which axis is measuring what, or the numbers are just numbers.
  if (!normalize && !autoNormalize) {
    ctx.textBaseline = 'top'
    if (left?.unit) {
      ctx.textAlign = 'left'
      ctx.fillText(left.unit, 4, 2)
    }
    if (right?.unit) {
      ctx.textAlign = 'right'
      ctx.fillText(right.unit, size.w - 4, 2)
    }
    ctx.textBaseline = 'middle'
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let i = 0; i <= 5; i++) {
    const x = PAD.left + (plotW * i) / 5
    ctx.beginPath()
    ctx.moveTo(Math.round(x) + 0.5, PAD.top)
    ctx.lineTo(Math.round(x) + 0.5, PAD.top + plotH)
    ctx.stroke()
    const t = view.t0 + ((view.t1 - view.t0) * i) / 5
    // The end labels would otherwise print half off the canvas.
    ctx.textAlign = i === 0 ? 'left' : i === 5 ? 'right' : 'center'
    ctx.fillText(`${t.toFixed(1)}s`, x, PAD.top + plotH + 6)
  }

  // The traces, clipped to the plot area so a pan cannot draw over the axes.
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD.left, PAD.top, plotW, plotH)
  ctx.clip()
  series.forEach((s, idx) => {
    ctx.strokeStyle = COLORS[idx % COLORS.length]!
    ctx.lineWidth = 1.4
    ctx.beginPath()
    // At most one line segment per pixel column: a log has far more samples
    // than the canvas has columns, and drawing them all is time spent
    // painting the same pixel.
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
