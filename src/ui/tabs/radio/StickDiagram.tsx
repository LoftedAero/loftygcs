import type { StickFunction } from './radio-cal'
import { STICK_SPECS } from './radio-cal'

// The transmitter, drawn so the instruction is unmistakable. QGC's radio page
// works because it shows you the stick to move and where to push it rather
// than describing it in a sentence you have to translate.
//
// Drawn for a mode-2 transmitter (throttle and yaw on the left), which is
// what the great majority of ArduPilot users fly. The gates and the arrow are
// the whole point, so nothing else is decorated.

const GATE_R = 26
const KNOB_R = 9
/** How far the knob sits from centre when a step calls for full deflection. */
const THROW = GATE_R - KNOB_R - 2

export interface StickDiagramProps {
  /** The function being identified, or null to draw both sticks centred. */
  active: StickFunction | null
  /** Live stick positions, -1..1, when the mapping is known. */
  live?: { left: { x: number; y: number }; right: { x: number; y: number } } | undefined
}

export default function StickDiagram({ active, live }: StickDiagramProps) {
  const spec = active ? STICK_SPECS[active] : null

  const offsetFor = (side: 'left' | 'right') => {
    if (spec && spec.stick === side) {
      // Screen y grows downward, so an "up" instruction is a negative offset.
      const d = THROW * spec.sense
      return spec.axis === 'x' ? { x: d, y: 0 } : { x: 0, y: -d }
    }
    if (live) {
      const p = live[side]
      return { x: p.x * THROW, y: -p.y * THROW }
    }
    return { x: 0, y: 0 }
  }

  return (
    <svg
      className="stick-diagram"
      viewBox="0 0 220 118"
      role="img"
      aria-label={
        spec
          ? `Move the ${spec.label.toLowerCase()} stick ${spec.maxDirection}`
          : 'Transmitter sticks centred'
      }
    >
      {/* Body */}
      <rect x="6" y="20" width="208" height="92" rx="14" className="stick-diagram__body" />
      {/* Antenna, purely so the shape reads as a transmitter at a glance */}
      <line x1="34" y1="20" x2="20" y2="4" className="stick-diagram__antenna" />

      {(['left', 'right'] as const).map((side) => {
        const cx = side === 'left' ? 68 : 152
        const cy = 66
        const off = offsetFor(side)
        const isActive = spec?.stick === side
        return (
          <g key={side}>
            <circle
              cx={cx}
              cy={cy}
              r={GATE_R}
              className={`stick-diagram__gate${isActive ? ' is-active' : ''}`}
            />
            {/* Cross-hairs give the eye a centre to judge deflection against */}
            <line x1={cx - 7} y1={cy} x2={cx + 7} y2={cy} className="stick-diagram__cross" />
            <line x1={cx} y1={cy - 7} x2={cx} y2={cy + 7} className="stick-diagram__cross" />
            {isActive && spec && (
              <Arrow cx={cx} cy={cy} axis={spec.axis} sense={spec.sense} />
            )}
            <circle
              cx={cx + off.x}
              cy={cy + off.y}
              r={KNOB_R}
              className={`stick-diagram__knob${isActive ? ' is-active' : ''}`}
            />
          </g>
        )
      })}
    </svg>
  )
}

function Arrow({
  cx,
  cy,
  axis,
  sense,
}: {
  cx: number
  cy: number
  axis: 'x' | 'y'
  sense: 1 | -1
}) {
  const reach = GATE_R + 15
  const tip =
    axis === 'x' ? { x: cx + reach * sense, y: cy } : { x: cx, y: cy - reach * sense }
  const from =
    axis === 'x'
      ? { x: cx + (GATE_R + 3) * sense, y: cy }
      : { x: cx, y: cy - (GATE_R + 3) * sense }
  // Head drawn as a triangle pointing along the same axis.
  const w = 5
  const head =
    axis === 'x'
      ? `${tip.x},${tip.y} ${tip.x - 8 * sense},${tip.y - w} ${tip.x - 8 * sense},${tip.y + w}`
      : `${tip.x},${tip.y} ${tip.x - w},${tip.y + 8 * sense} ${tip.x + w},${tip.y + 8 * sense}`
  return (
    <g className="stick-diagram__arrow">
      <line x1={from.x} y1={from.y} x2={tip.x} y2={tip.y} />
      <polygon points={head} />
    </g>
  )
}
