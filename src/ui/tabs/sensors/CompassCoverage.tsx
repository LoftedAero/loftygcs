import { useEffect, useRef } from 'react'
import { SECTIONS, sectionCovered, type Vec3 } from '../../../protocol/geodesic-grid'

// Where you have been, and where you have not.
//
// A compass calibration is a sampling problem: ArduPilot needs magnetic
// readings from all around the sphere of orientations, and MAG_CAL_PROGRESS
// tells you exactly which of its eighty sections it has samples for. Every
// ground station throws that away and shows a percentage instead -- QGC
// included, which draws a bar and a text area. A percentage answers "how much
// longer", which is the less useful question. The one somebody rotating an
// aircraft actually has is "which way haven't I pointed it yet", and the
// answer is in the message already.
//
// Drawn on a 2D canvas rather than with three.js: this is eighty flat
// triangles on a sphere seen from outside, which is an orthographic
// projection and a back-face test -- no meshes, no lighting, no model to
// load. It rotates slowly so the far side comes around on its own, and holds
// still for anyone who has asked for reduced motion.
//
// **Where you are is inferred from the mask itself, not read from the
// message.** MAG_CAL_PROGRESS has direction_x/y/z fields for exactly that
// purpose and ArduPilot sends 0.0f for all three --
// `mavlink_msg_mag_cal_progress_send` passes literal zeros -- so there is
// nothing to plot. The raw magnetometer reading is not a stand-in either:
// `update_completion_mask` sections the *soft-iron-corrected* vector, using
// calibration parameters still being estimated mid-run, and on the compass
// you are calibrating those two can differ by more than a section is wide.
//
// But a section that has just lit up is a section the vehicle was pointing
// at a moment ago, and that is derived from the one thing the firmware does
// populate. So newly covered sections flash and settle over a couple of
// seconds, leaving a short trail of where you have just been. It goes quiet
// while you are re-covering ground you have already done, which is honest:
// there is no news then, and no progress either.

/** Radians per second, slow enough to read and fast enough to see the back. */
const SPIN = 0.5

/** How long a newly covered section stays highlighted. */
const FRESH_MS = 2500

type Rgb = string

function rotate(v: Vec3, yaw: number, pitch: number): Vec3 {
  const [x, y, z] = v
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x1 = x * cy - z * sy
  const z1 = x * sy + z * cy
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp]
}

export default function CompassCoverage({
  mask,
  size = 168,
}: {
  mask: readonly number[]
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The mask changes several times a second; keeping it in a ref means the
  // animation loop is started once rather than restarted on every packet.
  const maskRef = useRef(mask)
  maskRef.current = mask
  // When each section was first covered, so the draw loop can fade it. Not
  // state: it changes on every packet and only the canvas reads it.
  const litAtRef = useRef<number[]>(new Array(SECTIONS.length).fill(0))
  const seenRef = useRef<boolean[]>(new Array(SECTIONS.length).fill(false))

  useEffect(() => {
    // Diff against what was covered before: the difference is where the
    // vehicle has just been pointed.
    const now = performance.now()
    for (let i = 0; i < SECTIONS.length; i++) {
      const lit = sectionCovered(mask, i)
      if (lit && !seenRef.current[i]) litAtRef.current[i] = now
      // A calibration that restarts clears the mask, and the trail with it.
      seenRef.current[i] = lit
    }
  }, [mask])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    // Tokens, read once: the sphere has to follow the theme like everything
    // else, and canvas cannot inherit a CSS custom property.
    const css = getComputedStyle(document.documentElement)
    const token = (name: string, fallback: string): Rgb =>
      css.getPropertyValue(name).trim() || fallback
    const covered = token('--la-ok', '#2FAE4E')
    const missing = token('--la-surface-2', '#F7F8FA')
    const edge = token('--la-line', '#E1E2E6')

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const r = size / 2 - 4
    const cx = size / 2
    const cy = size / 2
    let raf = 0
    const t0 = performance.now()

    const draw = (now: number) => {
      const yaw = still ? 0.6 : ((now - t0) / 1000) * SPIN
      const pitch = -0.42 // a little from above, so the top is legible
      ctx.clearRect(0, 0, size, size)

      // Paint far faces first: the near ones then cover them, which is all
      // the depth sorting eighty convex triangles on a sphere need.
      const faces = SECTIONS.map((tri, i) => {
        const pts = tri.map((v) => rotate(v, yaw, pitch))
        const depth = (pts[0]![2] + pts[1]![2] + pts[2]![2]) / 3
        return { i, pts, depth }
      }).sort((a, b) => a.depth - b.depth)

      for (const f of faces) {
        // Facing away: on a sphere the centroid's z says so.
        if (f.depth < 0) continue
        ctx.beginPath()
        f.pts.forEach((p, k) => {
          const x = cx + p[0]! * r
          const y = cy - p[1]! * r
          if (k === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.closePath()
        const lit = sectionCovered(maskRef.current, f.i)
        ctx.fillStyle = lit ? covered : missing
        ctx.fill()

        // Just lit: a white wash that fades out, leaving the settled green.
        // A wash rather than a second color because the palette spends
        // orange on actions and blue on controls -- this is status, and
        // status that invented a color would be the odd one out.
        const age = now - (litAtRef.current[f.i] ?? 0)
        if (lit && age < FRESH_MS) {
          ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * (1 - age / FRESH_MS)})`
          ctx.fill()
        }

        ctx.strokeStyle = edge
        ctx.lineWidth = 0.5
        ctx.stroke()
      }

      // The loop keeps running even under reduced motion: what that setting
      // is asking us to stop is the spin, which is vestibular, rather than a
      // highlight settling in place. So `still` fixes the viewpoint and the
      // fade carries on -- without it, a reduced-motion reader would get the
      // trail frozen at whatever it looked like on the first frame.
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      className="cal-sphere"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Compass calibration coverage: the lit areas are directions the vehicle has been pointed, and the brightest are the most recent"
    />
  )
}
