import { coaxialRank, type FrameMotor } from '../../../protocol/frame-layout'

// The frame, drawn from ArduPilot's own motor table (protocol/frame-layout).
//
// An SVG rather than a picture: it takes the theme's colours in both modes,
// stays sharp at any size, and carries no licence of its own -- ArduPilot's
// diagrams are CC BY-SA 3.0, which does not sit inside a GPL-3.0 app without
// dragging its ShareAlike terms along.
//
// What a reader checks against this is which way each propeller turns and
// which motor the test spins, so those are the two things drawn plainly.
// **Direction is carried by the arrow, and by a colour that survives dark
// mode.** It was a pale fill before -- `--la-blue-soft` is #17293a on a
// #1c1d21 surface, which is no difference at all -- so the arc takes the blue
// and the ink ramp, both legible against either ground.

/** How far out the motors sit. */
const R = 82

/**
 * Motors are sized to the frame, not to a constant.
 *
 * A deca puts ten motors on one circle and a dodecahexa stacks twelve onto
 * six arms, so a radius that suits a quad has their arrows running through
 * their neighbours. Measuring the closest pair and sizing from that keeps the
 * busy frames legible without shrinking the simple ones to nothing.
 */
function sizeFor(points: readonly { x: number; y: number }[]) {
  let gap = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y)
      if (d > 0.5) gap = Math.min(gap, d)
    }
  }
  if (!Number.isFinite(gap)) gap = 70
  const motor = Math.max(8, Math.min(14, gap * 0.38))
  return { motor, arc: motor + 5, span: gap < 42 ? 115 : 145 }
}

/** Where a motor sits, scaled to the drawing and offset if it is a stacked pair. */
function place(m: FrameMotor, rank: number) {
  // A coaxial pair shares a position; the lower motor is drawn slightly in
  // toward the centre so both numbers are readable.
  const pull = rank === 0 ? 1 : 0.58
  return { x: m.x * R * pull, y: -m.y * R * pull }
}

/** An arc with an arrowhead, showing which way the propeller turns. */
function SpinArc({ cw, r, span }: { cw: boolean; r: number; span: number }) {
  const mid = -90
  const start = cw ? mid - span / 2 : mid + span / 2
  const end = cw ? mid + span / 2 : mid - span / 2
  const p = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180
    return [r * Math.cos(rad), r * Math.sin(rad)]
  }
  const [x0, y0] = p(start)
  const [x1, y1] = p(end)
  const t = ((end + (cw ? 90 : -90)) * Math.PI) / 180
  const head = r * 0.38
  const hx = Math.cos(t) * head
  const hy = Math.sin(t) * head
  const nx = Math.cos(t + Math.PI / 2) * head * 0.55
  const ny = Math.sin(t + Math.PI / 2) * head * 0.55
  return (
    <g className={`frame-diagram__spin frame-diagram__spin--${cw ? 'cw' : 'ccw'}`}>
      <path d={`M ${x0} ${y0} A ${r} ${r} 0 0 ${cw ? 1 : 0} ${x1} ${y1}`} fill="none" />
      <polygon
        points={`${x1 + hx},${y1 + hy} ${x1 - nx},${y1 - ny} ${x1 + nx},${y1 + ny}`}
        stroke="none"
      />
    </g>
  )
}

/**
 * A servo, drawn as one: a plain body with a mounting lug under it.
 *
 * No flanges and no horn. At tile size those read as three stray pips around
 * a box rather than as a servo, and the lug alone -- offset, the way a real
 * one is -- is enough to say this is bolted to the airframe and is not a
 * propeller.
 */
function Servo({ s }: { s: number }) {
  const w = s * 1.55
  const h = s * 1.2
  return (
    <g className="frame-diagram__servo">
      <rect className="frame-diagram__servo-body" x={-w / 2} y={-h / 2} width={w} height={h} rx={2} />
      <rect
        className="frame-diagram__servo-lug"
        x={w * 0.1}
        y={h / 2 - 0.5}
        width={w * 0.33}
        height={h * 0.3}
        rx={1}
      />
    </g>
  )
}

export default function FrameDiagram({
  motors,
  className = 'frame-diagram',
  labels = 'motor',
}: {
  /** Already chosen by the caller, which knows what a tile should show. */
  motors: readonly FrameMotor[]
  /** Sized by where it is drawn: a card's own picture, or a tile in the table. */
  className?: string
  /**
   * Which of a motor's two numbers to draw.
   *
   * `motor` is ArduPilot's own numbering -- what `SERVOn_FUNCTION` calls
   * Motor1..12 and what every wiring diagram uses -- and is what a picture of
   * a frame is for. `test` is where it falls in the motor test sequence, drawn
   * as a letter so it cannot be mistaken for the other one; that is Mission
   * Planner's convention, and it is only right on a screen that is *running*
   * the test.
   */
  labels?: 'motor' | 'test'
}) {
  const label = (m: FrameMotor) =>
    labels === 'test' ? String.fromCharCode(64 + m.test) : m.n
  const ranks = coaxialRank(motors)
  const points = motors.map((m, i) => place(m, ranks[i]!))
  const { motor, arc, span } = sizeFor(points)

  return (
    <svg
      className={className}
      viewBox="-112 -112 224 224"
      role="img"
      aria-label={`${motors.filter((m) => !m.servo).length} motors, numbered as the motor test spins them`}
    >
      {/* The arms, under everything. */}
      <g className="frame-diagram__arms">
        {points.map((pt, i) => (
          <line key={motors[i]!.n} x1={0} y1={0} x2={pt.x} y2={pt.y} />
        ))}
      </g>

      {/* Forward is the shape of the middle, not a separate marker: the hub is
          the arrowhead, so the drawing has one orientation cue and it is where
          the eye already starts. */}
      <polygon className="frame-diagram__hub" points="0,-26 16,17 0,7 -16,17" />

      {motors.map((m, i) => {
        const { x, y } = points[i]!
        return (
          <g key={`${m.n}-${m.test}`} transform={`translate(${x} ${y})`}>
            {m.servo ? (
              <Servo s={motor} />
            ) : (
              <circle
                className={`frame-diagram__motor frame-diagram__motor--${m.spin}`}
                r={motor}
              />
            )}
            {m.spin !== 'none' && !m.servo && <SpinArc cw={m.spin === 'cw'} r={arc} span={span} />}
            <text className="frame-diagram__n" dy="0.35em" fontSize={motor * 1.15}>
              {label(m)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
