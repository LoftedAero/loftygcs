import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { SENSOR_BITS } from '../../../protocol/sensors'
import {
  armReadiness,
  batteryLabel,
  compassTicks,
  isFailsafe,
  linkLabel,
  tapeTicks,
} from './hud-draw'

// The HUD as a stack of layers rather than one canvas:
//
//   background   <- video goes here when there is a source (see video.ts)
//   horizon      <- artificial horizon and its instruments, switchable
//   overlays     <- state and telemetry text, switchable
//
// That is what makes "video with no horizon" and "instruments with no video"
// ordinary states rather than special cases. Everything draws on one canvas
// because it is all rAF-driven from the telemetry rings: full telemetry rate,
// zero React re-renders. The slower numbers come from the store snapshot,
// read imperatively for the same reason.

export interface HudProps {
  /** Draw the horizon and its instruments. Off leaves the background showing. */
  horizon: boolean
  /** Draw the state and telemetry text over whatever is behind it. */
  overlays: boolean
}

const SKY = '#7FB2E5'
const GROUND = '#9B7B4F'
const INK = '#FFFFFF'
const WARN = '#FF4136'
const OK = '#3BE07C'
const ACCENT = '#F7941D'
/** How long "ARMED" stays on screen after the transition. */
const ARMED_BANNER_MS = 4000

export default function Hud({ horizon, overlays }: HudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Read inside the animation frame rather than closed over, so toggling a
  // layer does not have to tear down and restart the loop.
  const flags = useRef({ horizon, overlays })
  flags.current = { horizon, overlays }
  // When the armed state last changed, so ARMED can announce itself and then
  // get out of the way. DISARMED stays up: on the ground it is the answer to
  // "why did nothing happen", and in the air it never appears.
  const armedAt = useRef({ armed: false, at: 0 })

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
      // Cleared, not painted over: whatever is in the background layer has to
      // show through wherever this frame does not draw.
      ctx.clearRect(0, 0, w, h)

      const roll = telemetryRings.rollRad.latest()
      const pitch = telemetryRings.pitchRad.latest()
      const v = useVehicleStore.getState()
      const link = useConnectionStore.getState().linkStats

      // Proportional to the panel, which is resizable: fixed constants that
      // suited a small corner panel leave a full-window HUD with a hairline
      // ladder and a symbol lost in the middle.
      const s = Math.min(1.4, Math.max(0.8, Math.min(w, h) / 300))
      const ribbon = 22 * s
      const tapeW = 46 * s
      const cx = w / 2
      // Centre the horizon below the compass ribbon so the two do not fight.
      const cy = ribbon + (h - ribbon) / 2
      const pxPerDeg = (h - ribbon) / 80

      const text = (
        str: string,
        x: number,
        y: number,
        align: CanvasTextAlign,
        color = INK,
        size = 12 * s,
        weight = '',
      ) => {
        if (!str) return
        ctx.font = `${weight} ${Math.round(size)}px "Roboto Mono", monospace`.trim()
        ctx.textAlign = align
        ctx.lineWidth = Math.max(2, 3 * s)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
        ctx.fillStyle = color
        ctx.strokeText(str, x, y)
        ctx.fillText(str, x, y)
      }

      if (flags.current.horizon) {
        const pitchPx = ((pitch * 180) / Math.PI) * pxPerDeg
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, ribbon, w, h - ribbon)
        ctx.clip()
        ctx.translate(cx, cy)
        ctx.rotate(-roll)
        ctx.translate(0, pitchPx)

        // Sky and ground, oversized so a full roll never shows an edge.
        ctx.fillStyle = SKY
        ctx.fillRect(-w * 2, -h * 4, w * 4, h * 4)
        ctx.fillStyle = GROUND
        ctx.fillRect(-w * 2, 0, w * 4, h * 4)
        ctx.strokeStyle = INK
        ctx.lineWidth = 2 * s
        ctx.beginPath()
        ctx.moveTo(-w * 2, 0)
        ctx.lineTo(w * 2, 0)
        ctx.stroke()

        // Pitch ladder every 10°, out to the edge of what the panel shows.
        const rung = 26 * s
        ctx.fillStyle = INK
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
          ctx.fillText(String(Math.abs(deg)), rung + 14 * s, y + 3 * s)
        }
        ctx.restore()

        drawRollArc(ctx, cx, cy, Math.min(w, h - ribbon) * 0.34, roll, s)
      }

      if (flags.current.overlays) {
        drawCompass(ctx, w, ribbon, v.headingDeg, s, text)
        drawTape(ctx, 0, ribbon, tapeW, h - ribbon, v.airspeedMs || v.groundspeedMs, 5, s, 'left', text)
        drawTape(ctx, w - tapeW, ribbon, tapeW, h - ribbon, v.relAltM, 10, s, 'right', text)

        // Fixed aircraft symbol: brand orange, always level.
        ctx.strokeStyle = ACCENT
        ctx.lineWidth = 3 * s
        ctx.beginPath()
        ctx.moveTo(cx - 40 * s, cy)
        ctx.lineTo(cx - 12 * s, cy)
        ctx.moveTo(cx + 12 * s, cy)
        ctx.lineTo(cx + 40 * s, cy)
        ctx.moveTo(cx, cy - 6 * s)
        ctx.lineTo(cx, cy)
        ctx.stroke()

        const pad = 6 * s
        const lineH = 15 * s

        // Speeds under the speed tape; mode under the altitude tape.
        text(`AS ${v.airspeedMs.toFixed(1)}`, tapeW + pad, h - pad - lineH, 'left')
        text(`GS ${v.groundspeedMs.toFixed(1)}`, tapeW + pad, h - pad, 'left')
        text(v.modeName || '—', w - tapeW - pad, h - pad - lineH, 'right', INK, 14 * s, 'bold')
        text(`THR ${v.throttlePct.toFixed(0)}%`, w - tapeW - pad, h - pad, 'right')

        // Battery bottom-left, above the speeds.
        text(batteryLabel(v.batteryV, v.batteryA, v.batteryPct), tapeW + pad, h - pad - lineH * 2, 'left')

        // Link quality top-right, under the ribbon. rxCount is already the
        // count over the last second, so it is the packet rate as it stands.
        text(linkLabel(v.rcRssi, link?.rxCount), w - tapeW - pad, ribbon + lineH, 'right')

        // Armed state, large and central -- the one thing that must never be
        // in doubt. It sits above the horizon centre so the aircraft symbol
        // stays readable underneath it.
        const stateY = cy - Math.min(w, h) * 0.16
        const now = Date.now()
        if (v.armed !== armedAt.current.armed) armedAt.current = { armed: v.armed, at: now }
        // ARMED is an event worth announcing, not a label worth keeping: it
        // shows for a few seconds and then leaves the horizon clear.
        const showArmed = v.armed && now - armedAt.current.at < ARMED_BANNER_MS
        if (!v.armed) text('DISARMED', cx, stateY, 'center', WARN, 22 * s, 'bold')
        else if (showArmed) text('ARMED', cx, stateY, 'center', WARN, 22 * s, 'bold')

        if (isFailsafe(v.systemStatus)) {
          text('FAILSAFE', cx, stateY + 26 * s, 'center', WARN, 24 * s, 'bold')
        }

        // Arming readiness, bottom centre, and only while disarmed.
        const readiness = armReadiness(
          v.armed,
          v.sensorsPresent,
          v.sensorsHealth,
          SENSOR_BITS.prearm,
        )
        if (readiness === 'ready') {
          text('Ready to arm', cx, h - pad, 'center', OK, 13 * s, 'bold')
        } else if (readiness === 'notReady') {
          text('Not ready to arm', cx, h - pad, 'center', WARN, 13 * s, 'bold')
        }
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

type TextFn = (
  str: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  color?: string,
  size?: number,
  weight?: string,
) => void

/** The heading ribbon across the top, sliding under a fixed marker. */
function drawCompass(
  ctx: CanvasRenderingContext2D,
  w: number,
  height: number,
  heading: number,
  s: number,
  text: TextFn,
) {
  const halfSpan = 50
  const pxPerDeg = w / 2 / halfSpan
  ctx.fillStyle = 'rgba(45, 45, 47, 0.55)'
  ctx.fillRect(0, 0, w, height)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, height)
  ctx.lineTo(w, height)
  ctx.stroke()

  for (const t of compassTicks(heading, halfSpan, 15)) {
    const x = w / 2 + t.offset * pxPerDeg
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.lineWidth = t.major ? 1.5 : 1
    ctx.beginPath()
    ctx.moveTo(x, height - (t.major ? 6 * s : 3 * s))
    ctx.lineTo(x, height)
    ctx.stroke()
    if (t.major) text(t.label, x, height - 8 * s, 'center', INK, 10 * s)
  }

  // The live heading, boxed at the centre so the eye has a fixed anchor.
  const label = `${Math.round(heading).toString().padStart(3, '0')}`
  const boxW = 34 * s
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(w / 2 - boxW / 2, 1, boxW, height - 2)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(w / 2 - boxW / 2, 1, boxW, height - 2)
  text(label, w / 2, height - 6 * s, 'center', INK, 12 * s, 'bold')
}

/** The roll arc and its pointer, over the top of the horizon. */
function drawRollArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  roll: number,
  s: number,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 1.5 * s
  ctx.beginPath()
  ctx.arc(0, 0, r, Math.PI * 1.18, Math.PI * 1.82)
  ctx.stroke()

  for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = -Math.PI / 2 + (deg * Math.PI) / 180
    const major = deg === 0 || Math.abs(deg) === 30 || Math.abs(deg) === 60
    const len = (major ? 9 : 5) * s
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len))
    ctx.stroke()
  }

  // The pointer rotates with the vehicle, so the gap between it and the
  // zero mark is the bank angle.
  ctx.rotate(-roll)
  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.moveTo(0, -r + 2 * s)
  ctx.lineTo(-5 * s, -r + 12 * s)
  ctx.lineTo(5 * s, -r + 12 * s)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** A vertical tape: ticks sliding past a boxed live value. */
function drawTape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  step: number,
  s: number,
  side: 'left' | 'right',
  text: TextFn,
) {
  const midY = y + h / 2
  const pxPerUnit = h / (step * 8)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = 'rgba(45, 45, 47, 0.45)'
  ctx.fillRect(x, y, w, h)

  for (const t of tapeTicks(value, (h / 2 / pxPerUnit) * 0.95, step)) {
    const ty = midY - t.offset * pxPerUnit
    const len = (t.major ? 9 : 5) * s
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.lineWidth = 1.2 * s
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
      text(
        String(Math.round(t.value)),
        side === 'left' ? x + w - len - 3 * s : x + len + 3 * s,
        ty + 3.5 * s,
        side === 'left' ? 'right' : 'left',
        INK,
        10 * s,
      )
    }
  }
  ctx.restore()

  // The live value, boxed against the horizon so it is always findable.
  const boxH = 17 * s
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.fillRect(x, midY - boxH / 2, w, boxH)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(x, midY - boxH / 2, w, boxH)
  text(value.toFixed(0), x + w / 2, midY + 4 * s, 'center', INK, 12 * s, 'bold')
}
