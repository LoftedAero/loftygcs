// Painting the HUD, kept apart from the React shell.
//
// Follows primary flight display convention: airspeed left and altitude right
// of the attitude indicator; a bank scale marked at 10, 20, 30 and 45 degrees
// with a slip/skid trapezoid under its pointer; a pitch ladder graduated
// finely near the horizon and dashed below it.
//
// Values are monospaced so digits do not jitter; labels are a dimmer,
// letter-spaced sans. Text is separated from the background with a soft
// shadow rather than an outline, which looks heavy at these sizes.

import { compassTicks, tapeTicks, type ArmReadiness, tapeStep } from './hud-draw'
import {
  fixed,
  formatSpeed,
  formatVerticalSpeed,
  speedLabel,
  toDistance,
  toSpeed,
  verticalSpeedLabel,
  type UnitPrefs,
} from '../../../units'

const SKY_TOP = '#1D5F9E'
const SKY_LOW = '#79B9E8'
const GROUND_HIGH = '#A67C46'
const GROUND_LOW = '#4A3520'
const INK = '#FFFFFF'
const DIM = 'rgba(255, 255, 255, 0.62)'
const AMBER = '#F7941D'
const GREEN = '#35D07F'
const RED = '#FF453A'
// Light enough that the horizon reads through the tapes and the heading
// ribbon, which also has the horizon drawn behind it.
const PANEL = 'rgba(14, 17, 22, 0.26)'
/**
 * Background of the chips behind the readiness line and the vehicle's
 * warning, opaque enough that ladder rungs do not show through the words.
 */
const CHIP = 'rgba(14, 17, 22, 0.82)'
const PANEL_EDGE = 'rgba(255, 255, 255, 0.18)'
const MONO = '"Roboto Mono", ui-monospace, monospace'
const SANS = '"Work Sans", system-ui, sans-serif'

const CAN_LETTER_SPACE =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'letterSpacing' in CanvasRenderingContext2D.prototype

export interface HudState {
  roll: number
  pitch: number
  headingDeg: number
  airspeedMs: number
  groundspeedMs: number
  relAltM: number
  climbMs: number
  throttlePct: number
  /** What the reader has asked to see; the numbers above stay SI. */
  units: UnitPrefs
  batteryText: string
  linkText: string
  gpsText: string
  /** Whether that fix will fly a position mode; red when it will not. */
  gpsUsable: boolean
  modeName: string
  armed: boolean
  showArmedBanner: boolean
  failsafe: boolean
  readiness: ArmReadiness
  /** The vehicle's latest warning, or the app's note on a command; null for none. */
  message: string | null
  horizon: boolean
  overlays: boolean
  /**
   * Video is showing behind this canvas, so the horizon draws only its
   * symbology (line, ladder, bank scale) and no sky or ground fill.
   */
  videoBehind: boolean
}

interface Text {
  size?: number
  color?: string
  weight?: string
  font?: string
  spacing?: number
  align?: CanvasTextAlign
  /** Shadow blur in scale units. Enough to separate, not enough to glow. */
  shadow?: number
}

/** Gradients depend only on height, so they are cached. */
let skyCache: { h: number; sky: CanvasGradient; ground: CanvasGradient } | null = null

function gradients(ctx: CanvasRenderingContext2D, h: number) {
  if (skyCache && skyCache.h === h) return skyCache
  const sky = ctx.createLinearGradient(0, -h, 0, 0)
  sky.addColorStop(0, SKY_TOP)
  sky.addColorStop(1, SKY_LOW)
  const ground = ctx.createLinearGradient(0, 0, 0, h)
  ground.addColorStop(0, GROUND_HIGH)
  ground.addColorStop(1, GROUND_LOW)
  skyCache = { h, sky, ground }
  return skyCache
}

export function paintHud(ctx: CanvasRenderingContext2D, w: number, h: number, st: HudState) {
  ctx.clearRect(0, 0, w, h)
  if (w < 40 || h < 40) return

  // Proportional to the panel, which is resizable.
  const s = Math.min(1.5, Math.max(0.75, Math.min(w, h) / 320))
  const ribbonH = 24 * s
  const tapeW = 50 * s
  const gap = 6 * s
  const cx = w / 2
  const cy = ribbonH + (h - ribbonH) / 2
  const pxPerDeg = (h - ribbonH) / 70

  const write = (str: string, x: number, y: number, o: Text = {}) => {
    if (!str) return
    const size = o.size ?? 12 * s
    ctx.save()
    ctx.font = `${o.weight ?? ''} ${Math.round(size)}px ${o.font ?? MONO}`.trim()
    ctx.textAlign = o.align ?? 'left'
    ctx.textBaseline = 'alphabetic'
    if (CAN_LETTER_SPACE && o.spacing) ctx.letterSpacing = `${o.spacing}px`
    // A light, soft shadow: legible over sky, ground or video without the
    // thickness of an outline or a halo that muddies colored text.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = (o.shadow ?? 2.6) * s
    ctx.shadowOffsetY = 1
    ctx.fillStyle = o.color ?? INK
    ctx.fillText(str, x, y)
    ctx.restore()
  }

  /** A dim caption and a bright value, the pairing used all over the HUD. */
  const pair = (
    caption: string,
    value: string,
    x: number,
    y: number,
    align: CanvasTextAlign,
    size = 13 * s,
  ) => {
    const capSize = 9 * s
    ctx.save()
    ctx.font = `500 ${Math.round(capSize)}px ${SANS}`
    const capW = ctx.measureText(caption).width + 5 * s
    ctx.restore()
    if (align === 'right') {
      write(value, x, y, { size, align: 'right' })
      ctx.save()
      ctx.font = `500 ${Math.round(size)}px ${MONO}`
      const valW = ctx.measureText(value).width
      ctx.restore()
      write(caption, x - valW - 5 * s, y, {
        size: capSize,
        color: DIM,
        font: SANS,
        weight: '500',
        spacing: 0.5,
        align: 'right',
      })
    } else {
      write(caption, x, y, {
        size: capSize,
        color: DIM,
        font: SANS,
        weight: '500',
        spacing: 0.5,
      })
      write(value, x + capW, y, { size })
    }
  }

  if (st.horizon) {
    paintHorizon(ctx, w, h, ribbonH, cx, cy, pxPerDeg, st, s)
    paintBank(ctx, cx, cy, Math.min(w, h - ribbonH) * 0.36, st.roll, s)
  }

  if (!st.overlays) return

  paintRibbon(ctx, w, ribbonH, st.headingDeg, s, write)

  // Short tapes centered on the horizon, as in Mission Planner, leaving room
  // for the speed readouts under each.
  const tapeH = Math.max(80, (h - ribbonH) * 0.52)
  const tapeTop = Math.max(ribbonH + gap, cy - tapeH / 2)
  const tapeBottom = tapeTop + tapeH
  // Converted once here so the tapes, readouts and labels agree.
  const spd = st.units.speed
  const dst = st.units.distance
  paintTape(
    ctx,
    gap,
    tapeTop,
    tapeW,
    tapeH,
    toSpeed(st.airspeedMs, spd),
    tapeStep('speed', spd),
    s,
    'left',
    write,
  )
  paintTape(
    ctx,
    w - tapeW - gap,
    tapeTop,
    tapeW,
    tapeH,
    toDistance(st.relAltM, dst),
    tapeStep('altitude', dst),
    s,
    'right',
    write,
  )

  paintAircraft(ctx, cx, cy, s)

  // Under the speed tape: the two speeds. Under the altitude tape: vertical
  // speed and throttle.
  const u1 = tapeBottom + 17 * s
  const u2 = u1 + 15 * s
  const left = gap
  const right = w - gap
  pair('AS', `${formatSpeed(st.airspeedMs, spd)} ${speedLabel(spd)}`, left, u1, 'left')
  pair('GS', `${formatSpeed(st.groundspeedMs, spd)} ${speedLabel(spd)}`, left, u2, 'left')
  const vs = formatVerticalSpeed(st.climbMs, st.units)
  pair(
    'V/S',
    `${st.climbMs >= 0 ? '+' : ''}${vs} ${verticalSpeedLabel(st.units)}`,
    right,
    u1,
    'right',
  )
  pair('THR', `${st.throttlePct.toFixed(0)}%`, right, u2, 'right')

  // The corners: battery bottom left, mode bottom right, link top right,
  // GPS top left, all at the same weight as the readouts above them.
  const corner = 13 * s
  write(st.batteryText, left, h - 8 * s, { size: corner })
  write(st.modeName || '—', right, h - 8 * s, {
    size: corner,
    weight: '600',
    font: SANS,
    spacing: 0.5,
    align: 'right',
  })
  write(st.linkText, right, ribbonH + 18 * s, { size: corner, align: 'right' })
  // GPS opposite the link on the same line. Red without a usable fix, since
  // position modes are then refused.
  write(st.gpsText, left, ribbonH + 18 * s, {
    size: corner,
    ...(st.gpsUsable ? {} : { color: RED, weight: '600' }),
  })

  // State, centered above the aircraft symbol.
  const stateY = cy - Math.min(w, h) * 0.17
  if (!st.armed) {
    write('DISARMED', cx, stateY, {
      size: 20 * s,
      weight: '700',
      font: SANS,
      spacing: 2.4 * s,
      align: 'center',
      color: RED,
    })
  } else if (st.showArmedBanner) {
    write('ARMED', cx, stateY, {
      size: 20 * s,
      weight: '700',
      font: SANS,
      spacing: 2.4 * s,
      align: 'center',
      color: RED,
    })
  }
  if (st.failsafe) {
    write('FAILSAFE', cx, stateY + 26 * s, {
      size: 22 * s,
      weight: '700',
      font: SANS,
      spacing: 2.4 * s,
      align: 'center',
      color: RED,
    })
  }

  // The latest warning, below the horizon center as in Mission Planner.
  // Truncated to fit between the tapes rather than wrapped; the Messages
  // pane has the full text.
  if (st.message) {
    const size = 12 * s
    const y = cy + Math.min(w, h) * 0.17
    const room = w - 2 * (tapeW + gap) - 24 * s
    ctx.save()
    ctx.font = `600 ${Math.round(size)}px ${SANS}`
    let text = st.message
    while (text.length > 4 && ctx.measureText(text).width > room) text = text.slice(0, -2)
    if (text !== st.message) text = `${text.trimEnd()}…`
    const tw = ctx.measureText(text).width + 20 * s
    ctx.beginPath()
    ctx.roundRect(cx - tw / 2, y - 14 * s, tw, 20 * s, 8 * s)
    ctx.fillStyle = CHIP
    ctx.fill()
    ctx.restore()
    write(text, cx, y, { size, weight: '600', font: SANS, align: 'center', color: RED })
  }

  if (st.readiness === 'ready' || st.readiness === 'notReady') {
    const ready = st.readiness === 'ready'
    const label = ready ? 'READY TO ARM' : 'NOT READY TO ARM'
    const y = h - 25 * s
    // On a chip so ladder rungs do not run through the words.
    ctx.save()
    ctx.font = `600 ${Math.round(11 * s)}px ${SANS}`
    // measureText ignores letter-spacing, so the chip allows for it.
    const tw = ctx.measureText(label).width + label.length * 1.1 * s + 20 * s
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(cx - tw / 2, y - 12 * s, tw, 17 * s, 8 * s)
    ctx.fillStyle = CHIP
    ctx.fill()
    ctx.restore()
    // Its own line above the corners, clear of the battery and mode.
    write(label, cx, y, {
      size: 11 * s,
      weight: '600',
      font: SANS,
      spacing: 1.1 * s,
      align: 'center',
      color: ready ? GREEN : RED,
    })
  }
}

function paintHorizon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  top: number,
  cx: number,
  cy: number,
  pxPerDeg: number,
  st: HudState,
  s: number,
) {
  const place = () => {
    ctx.translate(cx, cy)
    ctx.rotate(-st.roll)
    ctx.translate(0, ((st.pitch * 180) / Math.PI) * pxPerDeg)
  }

  // Sky and ground run the full height, behind the heading ribbon too, so the
  // ribbon is a translucent panel like the tapes.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.clip()
  place()
  const reach = Math.max(w, h) * 2
  // Over video the fill is omitted and the horizon is just a line.
  if (!st.videoBehind) {
    const g = gradients(ctx, h * 2)
    ctx.fillStyle = g.sky
    ctx.fillRect(-reach, -h * 2, reach * 2, h * 2)
    ctx.fillStyle = g.ground
    ctx.fillRect(-reach, 0, reach * 2, h * 2)
  }
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.6 * s
  ctx.beginPath()
  ctx.moveTo(-reach, 0)
  ctx.lineTo(reach, 0)
  ctx.stroke()
  ctx.restore()

  // The ladder stops at the ribbon so it does not show through the scale.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, w, h - top)
  ctx.clip()
  place()

  // Pitch ladder: finer near the horizon, dashed below it.
  ctx.lineCap = 'butt'
  const maxDeg = 60
  for (let deg = -maxDeg; deg <= maxDeg; deg += 5) {
    if (deg === 0) continue
    const major = deg % 10 === 0
    // 2.5° steps are only legible when there is room for them.
    if (!major && pxPerDeg < 6) continue
    const y = -deg * pxPerDeg
    if (Math.abs(y) > h) continue
    const half = (major ? 34 : 16) * s
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.lineWidth = (major ? 1.6 : 1.2) * s
    ctx.setLineDash(deg < 0 ? [6 * s, 5 * s] : [])
    ctx.beginPath()
    ctx.moveTo(-half, y)
    ctx.lineTo(half, y)
    ctx.stroke()
    // Down-turned ends.
    if (major) {
      ctx.setLineDash([])
      const tick = (deg > 0 ? 1 : -1) * 5 * s
      ctx.beginPath()
      ctx.moveTo(-half, y)
      ctx.lineTo(-half, y + tick)
      ctx.moveTo(half, y)
      ctx.lineTo(half, y + tick)
      ctx.stroke()
    }
    // Numbered on the left only, as in Mission Planner, to reduce clutter.
    if (major) {
      ctx.setLineDash([])
      ctx.font = `500 ${Math.round(10 * s)}px ${MONO}`
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.textAlign = 'right'
      ctx.fillText(String(Math.abs(deg)), -half - 6 * s, y + 3.5 * s)
    }
  }
  ctx.setLineDash([])
  ctx.restore()
}

/** Bank scale and its pointer, with the slip/skid trapezoid beneath. */
function paintBank(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  roll: number,
  s: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
  ctx.shadowBlur = 4 * s

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = 1.4 * s
  ctx.beginPath()
  ctx.arc(0, 0, r, Math.PI * 1.22, Math.PI * 1.78)
  ctx.stroke()

  // Marked where a PFD marks: 10, 20, 30, 45, plus 60 for the aerobatic end.
  for (const deg of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const a = -Math.PI / 2 + (deg * Math.PI) / 180
    const major = Math.abs(deg) === 30 || Math.abs(deg) === 60
    const len = (major ? 10 : 6) * s
    ctx.lineWidth = (major ? 1.8 : 1.2) * s
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len))
    ctx.stroke()
  }

  // Zero mark: a fixed hollow triangle at the top of the arc.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.beginPath()
  ctx.moveTo(0, -r - 2 * s)
  ctx.lineTo(-6 * s, -r - 12 * s)
  ctx.lineTo(6 * s, -r - 12 * s)
  ctx.closePath()
  ctx.stroke()

  // The moving pointer, and the slip trapezoid riding under it.
  ctx.rotate(-roll)
  ctx.fillStyle = AMBER
  ctx.beginPath()
  ctx.moveTo(0, -r + 1 * s)
  ctx.lineTo(-6 * s, -r + 11 * s)
  ctx.lineTo(6 * s, -r + 11 * s)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-6.5 * s, -r + 13.5 * s)
  ctx.lineTo(6.5 * s, -r + 13.5 * s)
  ctx.lineTo(5 * s, -r + 17.5 * s)
  ctx.lineTo(-5 * s, -r + 17.5 * s)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** The fixed aircraft reference: wings either side of a center mark. */
function paintAircraft(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
  ctx.shadowBlur = 4 * s
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = 5.5 * s
  ctx.lineJoin = 'round'
  const wing = (draw: () => void) => {
    draw()
    ctx.stroke()
    ctx.strokeStyle = AMBER
    ctx.lineWidth = 2.6 * s
    draw()
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineWidth = 5.5 * s
  }
  // Wings either side of a center vee, nearly meeting so it reads as one
  // symbol.
  wing(() => {
    ctx.beginPath()
    ctx.moveTo(-46 * s, 0)
    ctx.lineTo(-14 * s, 0)
    ctx.lineTo(-14 * s, 6 * s)
  })
  wing(() => {
    ctx.beginPath()
    ctx.moveTo(46 * s, 0)
    ctx.lineTo(14 * s, 0)
    ctx.lineTo(14 * s, 6 * s)
  })
  wing(() => {
    ctx.beginPath()
    ctx.moveTo(-11 * s, 0)
    ctx.lineTo(0, 7 * s)
    ctx.lineTo(11 * s, 0)
  })
  ctx.restore()
}

type Write = (str: string, x: number, y: number, o?: Text) => void

/** The heading ribbon, sliding under a fixed chevron. */
function paintRibbon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  heading: number,
  s: number,
  write: Write,
) {
  const halfSpan = 48
  const pxPerDeg = w / 2 / halfSpan
  // Skip labels that would sit under the heading box, allowing for the
  // label's own width.
  const boxHalf = 22 * s + 14 * s
  ctx.save()
  ctx.fillStyle = PANEL
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = PANEL_EDGE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h + 0.5)
  ctx.lineTo(w, h + 0.5)
  ctx.stroke()

  for (const t of compassTicks(heading, halfSpan, 15)) {
    const x = w / 2 + t.offset * pxPerDeg
    ctx.strokeStyle = t.major ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)'
    ctx.lineWidth = t.major ? 1.4 : 1
    ctx.beginPath()
    ctx.moveTo(x, h - (t.major ? 6 * s : 3.5 * s))
    ctx.lineTo(x, h)
    ctx.stroke()
    if (t.major && Math.abs(x - w / 2) > boxHalf) {
      const cardinal = /^[NSEW]/.test(t.label)
      write(t.label, x, h - 9 * s, {
        size: (cardinal ? 11 : 9.5) * s,
        color: cardinal ? INK : DIM,
        font: SANS,
        weight: cardinal ? '600' : '500',
        align: 'center',
      })
    }
  }
  ctx.restore()

  // A chevron rather than a box, so it does not cover the ribbon.
  const label = Math.round(heading).toString().padStart(3, '0')
  ctx.save()
  ctx.fillStyle = 'rgba(14, 17, 22, 0.82)'
  ctx.strokeStyle = PANEL_EDGE
  ctx.lineWidth = 1
  const bw = 40 * s
  const bh = h - 2
  ctx.beginPath()
  ctx.roundRect(w / 2 - bw / 2, 1, bw, bh, 3 * s)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = AMBER
  ctx.beginPath()
  ctx.moveTo(w / 2, h + 6 * s)
  ctx.lineTo(w / 2 - 5 * s, h)
  ctx.lineTo(w / 2 + 5 * s, h)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  write(label, w / 2, h - 7 * s, { size: 12.5 * s, weight: '600', align: 'center' })
}

/** A vertical tape: ticks sliding past a boxed live value with a pointer. */
function paintTape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  step: number,
  s: number,
  side: 'left' | 'right',
  write: Write,
) {
  const midY = y + h / 2
  const pxPerUnit = h / (step * 7)
  const r = 4 * s

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = PANEL
  ctx.fill()
  ctx.strokeStyle = PANEL_EDGE
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.clip()

  for (const t of tapeTicks(value, (h / 2 / pxPerUnit) * 0.98, step)) {
    const ty = midY - t.offset * pxPerUnit
    const len = (t.major ? 8 : 4) * s
    ctx.strokeStyle = t.major ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    if (side === 'left') {
      ctx.moveTo(x + w - len, ty)
      ctx.lineTo(x + w, ty)
    } else {
      ctx.moveTo(x, ty)
      ctx.lineTo(x + len, ty)
    }
    ctx.stroke()
    if (t.major) {
      write(
        String(Math.round(t.value)),
        side === 'left' ? x + w - len - 4 * s : x + len + 4 * s,
        ty + 3.5 * s,
        {
          size: 10 * s,
          color: 'rgba(255,255,255,0.85)',
          align: side === 'left' ? 'right' : 'left',
        },
      )
    }
  }
  ctx.restore()

  // The live value in a box pointing at the horizon.
  const bh = 20 * s
  const nose = 6 * s
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 6 * s
  ctx.fillStyle = 'rgba(10, 12, 16, 0.92)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  if (side === 'left') {
    ctx.moveTo(x, midY - bh / 2)
    ctx.lineTo(x + w, midY - bh / 2)
    ctx.lineTo(x + w + nose, midY)
    ctx.lineTo(x + w, midY + bh / 2)
    ctx.lineTo(x, midY + bh / 2)
  } else {
    ctx.moveTo(x + w, midY - bh / 2)
    ctx.lineTo(x, midY - bh / 2)
    ctx.lineTo(x - nose, midY)
    ctx.lineTo(x, midY + bh / 2)
    ctx.lineTo(x + w, midY + bh / 2)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  write(fixed(value, 0), x + w / 2, midY + 4.5 * s, {
    size: 14 * s,
    weight: '600',
    align: 'center',
  })
}
