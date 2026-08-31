// The plan as it is edited, as opposed to the plan as it is transferred.
//
// Two differences from the wire shape, both earned:
//
//  - Items carry a `uid` instead of trusting `seq`. Inserting or dragging a
//    row renumbers everything after it, and a React key or a selection that
//    is really an index breaks the moment that happens.
//  - Home is held apart from the list. ArduPilot keeps it as item 0, but it
//    is not a command -- the vehicle overwrites it with its own position at
//    arming -- so what a plan carries there is a *planned* home: the origin
//    for relative altitudes and the reference the profile is drawn against.
//
// Conversion to and from MissionItem[] happens at the edges, here, so
// nothing else has to remember that item 0 is special.
import { frameMatters } from './mission-commands'
import type { MissionItem } from './types'

export interface PlanItem {
  /** Stable across renumbering; not transferred. */
  uid: string
  frame: number
  command: number
  autocontinue: number
  param1: number
  param2: number
  param3: number
  param4: number
  /** Latitude in degrees * 1e7, as the wire carries it. */
  x: number
  /** Longitude in degrees * 1e7. */
  y: number
  /** Altitude in meters, in `frame`. */
  z: number
}

export interface PlanHome {
  /** Degrees * 1e7, matching item coordinates. */
  x: number
  y: number
  /** Meters above mean sea level: home is always absolute. */
  z: number
}

export interface MissionPlan {
  home: PlanHome | null
  items: PlanItem[]
}

let uidCounter = 0
export function newUid(): string {
  return `i${++uidCounter}`
}

/** Splits a downloaded or loaded mission into home and the editable items. */
export function planFromItems(items: readonly MissionItem[]): MissionPlan {
  const [first, ...rest] = items
  const home: PlanHome | null = first ? { x: first.x, y: first.y, z: first.z } : null
  return {
    home,
    items: rest.map((it) => ({
      uid: newUid(),
      frame: it.frame,
      command: it.command,
      autocontinue: it.autocontinue,
      param1: it.param1,
      param2: it.param2,
      param3: it.param3,
      param4: it.param4,
      x: it.x,
      y: it.y,
      z: it.z,
    })),
  }
}

/**
 * Flattens back to wire items, home first and sequences contiguous from 0.
 * Home goes out as a NAV_WAYPOINT in the global frame, which is what
 * ArduPilot stores and what every other station writes.
 */
export function planToItems(plan: MissionPlan): MissionItem[] {
  const home = plan.home ?? { x: 0, y: 0, z: 0 }
  const out: MissionItem[] = [
    {
      seq: 0,
      frame: 0,
      command: 16,
      current: 1,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: home.x,
      y: home.y,
      z: home.z,
    },
  ]
  plan.items.forEach((it, i) => {
    out.push({
      seq: i + 1,
      frame: it.frame,
      command: it.command,
      current: 0,
      autocontinue: it.autocontinue,
      param1: it.param1,
      param2: it.param2,
      param3: it.param3,
      param4: it.param4,
      x: it.x,
      y: it.y,
      z: it.z,
    })
  })
  return out
}

/**
 * Whether two plans differ in any way the vehicle would notice.
 *
 * Not a deep equality: `uid` is ours alone, and `frame` is ignored on
 * commands that carry no position or altitude, because ArduPilot reports 0
 * for those on read-back regardless of what was uploaded. Comparing it
 * would mark every mission dirty the instant it was read back -- which is
 * exactly what happened the first time this ran against SITL.
 */
export function plansDiffer(a: MissionPlan, b: MissionPlan): boolean {
  if (!!a.home !== !!b.home) return true
  if (a.home && b.home) {
    if (a.home.x !== b.home.x || a.home.y !== b.home.y) return true
    if (!near(a.home.z, b.home.z)) return true
  }
  if (a.items.length !== b.items.length) return true
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i]!
    const y = b.items[i]!
    if (x.command !== y.command) return true
    if (frameMatters(x.command) && x.frame !== y.frame) return true
    if (x.x !== y.x || x.y !== y.y) return true
    if (x.autocontinue !== y.autocontinue) return true
    if (!near(x.z, y.z)) return true
    if (
      !near(x.param1, y.param1) ||
      !near(x.param2, y.param2) ||
      !near(x.param3, y.param3) ||
      !near(x.param4, y.param4)
    ) {
      return true
    }
  }
  return false
}

/** Floats round-trip through the wire as float32; exact equality is a trap. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4
}

const EARTH_R = 6371008.8

/** Great-circle distance in meters between two degrees*1e7 points. */
export function distanceM(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const toRad = (v: number) => ((v / 1e7) * Math.PI) / 180
  const lat1 = toRad(a.x)
  const lat2 = toRad(b.x)
  const dLat = lat2 - lat1
  const dLon = toRad(b.y) - toRad(a.y)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export interface LegStat {
  /** Ground distance from the previous located item, meters. */
  legM: number
  /** Cumulative ground distance from home, meters. */
  totalM: number
}

/**
 * Distance along the route, item by item. Items without a position (takeoff,
 * a servo command) inherit the running total rather than resetting it, so
 * the profile and the table agree about where along the mission each row is.
 */
export function legStats(plan: MissionPlan): LegStat[] {
  const out: LegStat[] = []
  let prev: { x: number; y: number } | null = plan.home
  let total = 0
  for (const it of plan.items) {
    let legM = 0
    if (hasCoords(it)) {
      if (prev) legM = distanceM(prev, it)
      total += legM
      prev = { x: it.x, y: it.y }
    }
    out.push({ legM, totalM: total })
  }
  return out
}

/** A zero position means "wherever the vehicle is", not the Gulf of Guinea. */
export function hasCoords(it: { x: number; y: number }): boolean {
  return it.x !== 0 || it.y !== 0
}
