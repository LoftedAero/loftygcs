import { useEffect, useRef } from 'react'
import { telemetryRings } from '../../../services/telemetry-ring'
import { useVehicleStore } from '../../../stores/vehicle-store'
import { useConnectionStore } from '../../../stores/connection-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { SENSOR_BITS } from '../../../protocol/sensors'
import {
  armReadiness,
  batteryLabel,
  gpsLabel,
  gpsUsable,
  hudMessage,
  isFailsafe,
  linkLabel,
} from './hud-draw'
import { useHudNoteStore } from '../../../stores/hud-note-store'
import { paintHud, type HudAvoid, type HudHits, type HudRect } from './hud-paint'
import VideoLayer from './VideoLayer'
import { videoService } from '../../../services/video'

// The HUD as a stack of layers rather than one canvas:
//
//   background   <- video goes here when there is a source (see video.ts)
//   horizon      <- artificial horizon and its instruments, switchable
//   overlays     <- tapes, state and telemetry, switchable
//
// The instruments are drawn on one canvas from the telemetry rings on
// requestAnimationFrame, with no React re-renders; slower values are read
// imperatively from the store snapshot. The drawing is in hud-paint.ts.

export interface HudProps {
  /** Draw the horizon and its instruments. Off leaves the background showing. */
  horizon: boolean
  /** Draw the tapes, state and telemetry over whatever is behind them. */
  overlays: boolean
  /** Areas covered by compact Fly's controls, kept clear (see HudAvoid). */
  avoid?: HudAvoid | null
  /** The picture-in-picture inset's reduced HUD (see HudState.mini). */
  mini?: boolean
  /** Screen position of a right-click on the HUD, for its own menu. */
  onContextMenu?: (p: { x: number; y: number }) => void
  /** A click on the READY / NOT READY TO ARM pill. Without it the pill is inert. */
  onReadinessClick?: () => void
}

/** How long "ARMED" stays on screen after the transition. */
const ARMED_BANNER_MS = 4000

/** The smallest a touch target may be on its short side (ux-rules: Touch). */
const TOUCH_MIN = 44

/**
 * Whether a point lands on a drawn box. A finger gets the box grown to the
 * touch minimum, since the pill is drawn about 17px tall.
 */
function hitsRect(r: HudRect | undefined, x: number, y: number, touch: boolean): boolean {
  if (!r) return false
  const padX = touch ? Math.max(0, (TOUCH_MIN - r.w) / 2) : 0
  const padY = touch ? Math.max(0, (TOUCH_MIN - r.h) / 2) : 0
  return x >= r.x - padX && x <= r.x + r.w + padX && y >= r.y - padY && y <= r.y + r.h + padY
}

export default function Hud({
  horizon,
  overlays,
  avoid = null,
  mini = false,
  onContextMenu,
  onReadinessClick,
}: HudProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Where the last frame drew its clickable elements.
  const hits = useRef<HudHits>({})
  // Read inside the animation frame rather than closed over, so toggling a
  // layer does not have to tear down and restart the loop.
  const flags = useRef({ horizon, overlays, avoid, mini })
  flags.current = { horizon, overlays, avoid, mini }
  // When the armed state last changed, so the ARMED banner can time out.
  // DISARMED stays up.
  const armedAt = useRef({ armed: false, at: 0 })
  // Whether video is playing behind the canvas; a ref so it causes no re-render.
  const videoBehind = useRef(false)
  useEffect(() => videoService.onStatus((s) => (videoBehind.current = s.state === 'playing')), [])

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

      const v = useVehicleStore.getState()
      const link = useConnectionStore.getState().linkStats
      const now = Date.now()
      if (v.armed !== armedAt.current.armed) armedAt.current = { armed: v.armed, at: now }

      hits.current = paintHud(ctx, w, h, {
        roll: telemetryRings.rollRad.latest(),
        pitch: telemetryRings.pitchRad.latest(),
        headingDeg: v.headingDeg,
        airspeedMs: v.airspeedMs,
        groundspeedMs: v.groundspeedMs,
        relAltM: v.relAltM,
        climbMs: v.climbMs,
        units: usePreferencesStore.getState().units,
        throttlePct: v.throttlePct,
        batteryText: batteryLabel(v.batteryV, v.batteryA, v.batteryPct),
        // rxCount is the count over the last second, i.e. the packet rate.
        linkText: linkLabel(v.rcRssi, link?.rxCount),
        // Blank with no vehicle rather than "No GPS".
        gpsText: v.present ? gpsLabel(v.gpsFix, v.gpsSats) : '',
        gpsUsable: !v.present || gpsUsable(v.gpsFix),
        modeName: v.modeName,
        armed: v.armed,
        showArmedBanner: v.armed && now - armedAt.current.at < ARMED_BANNER_MS,
        failsafe: isFailsafe(v.systemStatus),
        readiness: armReadiness(v.armed, v.sensorsPresent, v.sensorsHealth, SENSOR_BITS.prearm),
        message: hudMessage(v.statusTexts, useHudNoteStore.getState().note, now),
        horizon: flags.current.horizon,
        overlays: flags.current.overlays,
        videoBehind: videoBehind.current,
        avoid: flags.current.avoid,
        mini: flags.current.mini,
      })
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  /** The point in the canvas's own CSS pixels, which is what the painter used. */
  const onPill = (clientX: number, clientY: number, touch: boolean) => {
    const canvas = canvasRef.current
    if (!canvas || !onReadinessClick) return false
    const r = canvas.getBoundingClientRect()
    return hitsRect(hits.current.readiness, clientX - r.left, clientY - r.top, touch)
  }

  return (
    <div
      className="flight-hud"
      onClick={(e) => {
        const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
        if (onPill(e.clientX, e.clientY, touch)) onReadinessClick?.()
      }}
      // The cursor is set directly rather than through state: the pill moves
      // with the layout and is re-tested on every move, which would otherwise
      // be a render per mouse event.
      onMouseMove={(e) => {
        const canvas = canvasRef.current
        if (canvas) canvas.style.cursor = onPill(e.clientX, e.clientY, false) ? 'pointer' : ''
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        // Our menu replaces the browser's, as on the map.
        e.preventDefault()
        onContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* The background layer: decoded video, behind the instruments. */}
      <div className="flight-hud__background">
        <VideoLayer />
      </div>
      <canvas ref={canvasRef} className="flight-hud__canvas" />
    </div>
  )
}
