// Geofences and rally points: the model, and its translation to and from the
// wire.
//
// Both use the mission protocol, distinguished only by `mission_type`, so
// MissionClient transfers them.
//
// On the wire a fence is a flat list of items. A polygon is N consecutive
// vertex items, each repeating the polygon's vertex count in param1; there is
// no other boundary marker. The UI edits whole shapes and the flattening
// happens here.
//
// Rally points are one item each.
import type { MissionItem } from './types'

/** MAV_CMD values that make up a fence. */
export const FENCE_CMD = {
  returnPoint: 5000,
  inclusionVertex: 5001,
  exclusionVertex: 5002,
  inclusionCircle: 5003,
  exclusionCircle: 5004,
} as const

export const RALLY_CMD = 5100

export type FenceShape =
  | {
      uid: string
      kind: 'polygon'
      /** Keep the vehicle in (inclusion) or out (exclusion). */
      inclusive: boolean
      /** Degrees * 1e7, in order. */
      points: { x: number; y: number }[]
    }
  | {
      uid: string
      kind: 'circle'
      inclusive: boolean
      center: { x: number; y: number }
      radiusM: number
    }

/**
 * The editable fields of a shape, flattened across both kinds. `Omit` over
 * the union would keep only the shared fields, dropping `points` and `radiusM`.
 */
export type FenceShapePatch = Partial<{
  inclusive: boolean
  points: { x: number; y: number }[]
  center: { x: number; y: number }
  radiusM: number
}>

export interface FencePlan {
  shapes: FenceShape[]
  /**
   * Where the vehicle goes on a breach, if a return point is set. At most
   * one exists: ArduPilot stores a single FENCE_RETURN_POINT.
   */
  returnPoint: { x: number; y: number } | null
}

export interface RallyPoint {
  uid: string
  x: number
  y: number
  /** Altitude in meters, relative to home. */
  altM: number
}

let uidCounter = 0
export function newFenceUid(): string {
  return `f${++uidCounter}`
}

export const emptyFence = (): FencePlan => ({ shapes: [], returnPoint: null })

/**
 * Groups a downloaded fence back into shapes.
 *
 * A truncated or malformed vertex run is kept as far as it goes and reported,
 * since dropping it would hide a fence the vehicle may be enforcing.
 */
export function fenceFromItems(items: readonly MissionItem[]): {
  plan: FencePlan
  problems: string[]
} {
  const plan = emptyFence()
  const problems: string[] = []
  let i = 0
  while (i < items.length) {
    const it = items[i]!
    switch (it.command) {
      case FENCE_CMD.returnPoint:
        if (plan.returnPoint) problems.push('More than one return point; kept the first.')
        else plan.returnPoint = { x: it.x, y: it.y }
        i += 1
        break
      case FENCE_CMD.inclusionVertex:
      case FENCE_CMD.exclusionVertex: {
        const inclusive = it.command === FENCE_CMD.inclusionVertex
        const want = Math.round(it.param1)
        const points: { x: number; y: number }[] = []
        // Take vertices while they keep agreeing that they belong together.
        while (i < items.length && points.length < want) {
          const v = items[i]!
          if (v.command !== it.command || Math.round(v.param1) !== want) break
          points.push({ x: v.x, y: v.y })
          i += 1
        }
        if (points.length < 3) {
          problems.push(
            `A ${inclusive ? 'inclusion' : 'exclusion'} polygon has only ${points.length} ` +
              `of ${want} vertices and was dropped.`,
          )
        } else {
          if (points.length < want) {
            problems.push(`A polygon declared ${want} vertices but only ${points.length} arrived.`)
          }
          plan.shapes.push({ uid: newFenceUid(), kind: 'polygon', inclusive, points })
        }
        break
      }
      case FENCE_CMD.inclusionCircle:
      case FENCE_CMD.exclusionCircle:
        plan.shapes.push({
          uid: newFenceUid(),
          kind: 'circle',
          inclusive: it.command === FENCE_CMD.inclusionCircle,
          center: { x: it.x, y: it.y },
          radiusM: it.param1,
        })
        i += 1
        break
      default:
        problems.push(`Unknown fence command ${it.command} at ${i}; ignored.`)
        i += 1
        break
    }
  }
  return { plan, problems }
}

/** Flattens a fence for upload. Sequence numbers are contiguous from 0. */
export function fenceToItems(plan: FencePlan): MissionItem[] {
  const out: MissionItem[] = []
  const push = (command: number, x: number, y: number, param1: number) => {
    out.push({
      seq: out.length,
      // Fence items are always global with no altitude: ArduPilot enforces
      // shapes in two dimensions, plus the FENCE_ALT_MAX parameter.
      frame: 0,
      command,
      current: 0,
      autocontinue: 1,
      param1,
      param2: 0,
      param3: 0,
      param4: 0,
      x,
      y,
      z: 0,
    })
  }
  for (const s of plan.shapes) {
    if (s.kind === 'polygon') {
      const cmd = s.inclusive ? FENCE_CMD.inclusionVertex : FENCE_CMD.exclusionVertex
      for (const p of s.points) push(cmd, p.x, p.y, s.points.length)
    } else {
      const cmd = s.inclusive ? FENCE_CMD.inclusionCircle : FENCE_CMD.exclusionCircle
      push(cmd, s.center.x, s.center.y, s.radiusM)
    }
  }
  // Last, so a truncated upload loses the return point rather than a boundary.
  if (plan.returnPoint) push(FENCE_CMD.returnPoint, plan.returnPoint.x, plan.returnPoint.y, 0)
  return out
}

export function rallyFromItems(items: readonly MissionItem[]): RallyPoint[] {
  return items
    .filter((it) => it.command === RALLY_CMD)
    .map((it) => ({ uid: newFenceUid(), x: it.x, y: it.y, altM: it.z }))
}

export function rallyToItems(points: readonly RallyPoint[]): MissionItem[] {
  return points.map((p, seq) => ({
    seq,
    // Relative to home, which is how ArduPilot stores rally altitudes.
    frame: 3,
    command: RALLY_CMD,
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: p.x,
    y: p.y,
    z: p.altM,
  }))
}

/**
 * What is wrong with this fence, in the vehicle's terms. Checked before
 * upload because the vehicle rejects with a single MAV_MISSION_ERROR that
 * does not say which shape caused it.
 */
export function validateFence(plan: FencePlan): string[] {
  const out: string[] = []
  for (const s of plan.shapes) {
    if (s.kind === 'polygon') {
      if (s.points.length < 3) out.push('A polygon needs at least three corners.')
    } else if (!(s.radiusM > 0)) {
      out.push('A circle needs a radius greater than zero.')
    }
  }
  // On a breach ArduPilot flies to the return point, so a return point
  // outside every inclusion fence causes another breach.
  const inclusions = plan.shapes.filter((s) => s.inclusive)
  if (plan.returnPoint && inclusions.length > 0) {
    const inside = inclusions.some((s) => containsPoint(s, plan.returnPoint!))
    if (!inside) out.push('The return point is outside every inclusion fence.')
  }
  for (const s of plan.shapes) {
    if (!s.inclusive && plan.returnPoint && containsPoint(s, plan.returnPoint)) {
      out.push('The return point is inside an exclusion fence.')
      break
    }
  }
  return out
}

/** Point-in-shape, in degrees * 1e7. */
export function containsPoint(shape: FenceShape, p: { x: number; y: number }): boolean {
  if (shape.kind === 'circle') return distanceM(shape.center, p) <= shape.radiusM
  // Ray casting, half-open on the vertical so a vertex is counted once.
  let inside = false
  const pts = shape.points
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    if (a.x > p.x !== b.x > p.x) {
      const t = (p.x - a.x) / (b.x - a.x)
      if (p.y < a.y + t * (b.y - a.y)) inside = !inside
    }
  }
  return inside
}

const EARTH_R = 6378137

/** Great-circle-ish distance in meters between two degrees*1e7 points. */
export function distanceM(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const lat = ((a.x + b.x) / 2 / 1e7) * (Math.PI / 180)
  const dx = ((b.x - a.x) / 1e7) * (Math.PI / 180) * EARTH_R
  const dy = ((b.y - a.y) / 1e7) * (Math.PI / 180) * EARTH_R * Math.cos(lat)
  return Math.hypot(dx, dy)
}
