import type { Direction, StickFunction } from './radio-cal'
import { STICK_SPECS } from './radio-cal'

// A transmitter drawing that shows which stick to move and which way, as
// QGroundControl's radio page does. Mode 2 (throttle and yaw on the left),
// which most ArduPilot users fly. Only the gates, knobs and arrow are colored.

/** Half the side of a square gimbal gate. */
const GATE = 28
/** The round bezel a gimbal sits in, around its gate. */
const BEZEL_R = GATE + 8
const KNOB_R = 9
/** How far the knob sits from center when a step calls for full deflection. */
const THROW = GATE - KNOB_R - 3
const CY = 88
const CX = { left: 72, right: 168 } as const
const DIALS = [30, 210]

export interface StickDiagramProps {
  /** The function being asked for, or null when none is. */
  active: StickFunction | null
  /** Which way it is asked for; the max direction unless it says otherwise. */
  direction?: Direction
  /**
   * Where the throttle rests when it is not the stick being asked for. Down
   * by default (a throttle has no spring); up during the calibration's yaw
   * steps to avoid the rudder-arm gesture (see IDENTIFY_STEPS).
   */
  throttle?: 'up' | 'down'
  /**
   * Live stick positions, -1 to 1 with the channel's high end positive,
   * instead of an instruction (used by the gamepad pane). A function left out
   * stays centered.
   */
  positions?: Partial<Record<StickFunction, number>>
}

export default function StickDiagram({
  active,
  direction = 'max',
  throttle = 'down',
  positions,
}: StickDiagramProps) {
  const spec = active && !positions ? STICK_SPECS[active] : null
  // +1 toward the max direction's side of the drawing, -1 toward the min's.
  const toward = direction === 'max' ? 1 : -1

  const offsetFor = (side: 'left' | 'right') => {
    if (positions) {
      const off = { x: 0, y: 0 }
      for (const [fn, v] of Object.entries(positions) as [StickFunction, number][]) {
        const s = STICK_SPECS[fn]
        if (s.stick !== side || !Number.isFinite(v)) continue
        const d = THROW * s.sense * Math.max(-1, Math.min(1, v))
        if (s.axis === 'x') off.x = d
        else off.y = -d
      }
      return off
    }
    // Mode 2: the left stick's vertical is the throttle.
    const off = { x: 0, y: side === 'left' ? (throttle === 'up' ? -THROW : THROW) : 0 }
    if (spec && spec.stick === side) {
      // Screen y grows downward, so an "up" instruction is a negative offset.
      const d = THROW * spec.sense * toward
      if (spec.axis === 'x') off.x = d
      else off.y = -d
    }
    return off
  }

  return (
    <svg
      className={positions ? 'stick-diagram stick-diagram--live' : 'stick-diagram'}
      viewBox="0 0 240 152"
      role="img"
      aria-label={
        positions
          ? 'Transmitter showing the stick positions being sent'
          : spec
            ? `Move the ${spec.label.toLowerCase()} stick ${direction === 'max' ? spec.maxDirection : spec.minDirection}`
            : 'Transmitter with the sticks centered and the throttle down'
      }
    >
      <rect x="8" y="20" width="224" height="124" rx="22" className="stick-diagram__case" />
      {/* A dial at each top corner, its pointer at twelve o'clock. */}
      {DIALS.map((x) => (
        <g key={x} className="stick-diagram__dial">
          <circle cx={x} cy="36" r="7" />
          <line x1={x} y1="30" x2={x} y2="34" />
        </g>
      ))}
      <rect x="102" y="34" width="36" height="22" rx="3" className="stick-diagram__screen" />

      {(['left', 'right'] as const).map((side) => {
        const cx = CX[side]
        const off = offsetFor(side)
        // Live, a stick is lit when something drives it.
        const isActive = positions
          ? Object.keys(positions).some((fn) => STICK_SPECS[fn as StickFunction].stick === side)
          : spec?.stick === side
        return (
          <g key={side}>
            <circle cx={cx} cy={CY} r={BEZEL_R} className="stick-diagram__bezel" />
            <rect
              x={cx - GATE}
              y={CY - GATE}
              width={GATE * 2}
              height={GATE * 2}
              rx="9"
              className={`stick-diagram__gate${isActive ? ' is-active' : ''}`}
            />
            {/* Cross-hairs give the eye a center to judge deflection against */}
            <line x1={cx - 7} y1={CY} x2={cx + 7} y2={CY} className="stick-diagram__cross" />
            <line x1={cx} y1={CY - 7} x2={cx} y2={CY + 7} className="stick-diagram__cross" />
            {/* Drawn along the knob's row or column, e.g. at the top of the
                gate for yaw with the throttle held up. */}
            {isActive && spec && (
              <Arrow
                cx={spec.axis === 'y' ? cx + off.x : cx}
                cy={spec.axis === 'x' ? CY + off.y : CY}
                axis={spec.axis}
                sense={(spec.sense * toward) as 1 | -1}
              />
            )}
            <g
              className={`stick-diagram__knob${isActive ? ' is-active' : ''}`}
              style={{ transform: `translate(${off.x}px, ${off.y}px)` }}
            >
              <circle cx={cx} cy={CY} r={KNOB_R} />
              {/* The stick end's rim, so the knob reads as a stick from above. */}
              <circle cx={cx} cy={CY} r={KNOB_R - 4} className="stick-diagram__knob-top" />
            </g>
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
  const reach = GATE + 15
  const tip = axis === 'x' ? { x: cx + reach * sense, y: cy } : { x: cx, y: cy - reach * sense }
  const from =
    axis === 'x' ? { x: cx + (GATE + 3) * sense, y: cy } : { x: cx, y: cy - (GATE + 3) * sense }
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
