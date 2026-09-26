// Radio calibration logic, QGroundControl's way: the wizard walks the sticks
// one at a time and *derives* the channel mapping and the reversals, instead
// of capturing endpoints and leaving the user to work out RCMAP_* and
// RCn_REVERSED for themselves the way Mission Planner does.
//
// No React here -- the sign conventions below are the part that has to be
// right, so they are the part that is unit-tested.

/**
 * Which physical stick direction ArduPilot treats as a channel's maximum.
 *
 * Taken from the firmware rather than from folklore. In AP_Math's
 * rc_input_to_roll_pitch_rad the horizontal thrust is
 *   thrust.x = -tan(angle_max * pitch_in);  pitch_out = -atan(thrust.x)
 * so pitch_out carries the same sign as the stick input, and a positive Euler
 * pitch is nose *up*. Roll comes through with its sign unchanged too, and a
 * positive Euler roll is to the right. Yaw rate and throttle are positive for
 * right and up respectively.
 *
 * So a fully deflected stick reads as the channel maximum when it is pushed:
 *   roll  -> right      pitch -> back (nose up)
 *   yaw   -> right      throttle -> up
 *
 * The pitch case is the one worth stating out loud: plenty of transmitters
 * raise the elevator PWM when the stick goes *forward*, and those need
 * RCn_REVERSED set. That is exactly the detail a calibration should settle
 * for the user rather than leave them to discover in the air.
 */
export type StickFunction = 'roll' | 'pitch' | 'throttle' | 'yaw'

export const STICK_FUNCTIONS: readonly StickFunction[] = ['throttle', 'yaw', 'roll', 'pitch']

export interface StickSpec {
  fn: StickFunction
  label: string
  /** The direction that must read as the channel's maximum. */
  maxDirection: string
  /** The opposite one, asked for second to check the first. */
  minDirection: string
  /**
   * Springs back to center. The throttle does not: it rests wherever it was
   * left, which is at the bottom when the wizard takes its centered sample.
   */
  centered: boolean
  /** Which stick it lives on for a mode-2 transmitter, for the diagram. */
  stick: 'left' | 'right'
  axis: 'x' | 'y'
  /**
   * Where the knob is drawn for the max direction, in a frame where up the
   * screen means away from the pilot. Throttle up is a push away, so it
   * draws up; pitch back is a pull toward, so it draws down. Presentation
   * only -- the reversal is decided by the measured pulse width, never by
   * this.
   */
  sense: 1 | -1
  rcmapParam: string
}

export const STICK_SPECS: Record<StickFunction, StickSpec> = {
  throttle: {
    fn: 'throttle',
    label: 'Throttle',
    maxDirection: 'all the way up',
    minDirection: 'all the way down',
    centered: false,
    stick: 'left',
    axis: 'y',
    sense: 1,
    rcmapParam: 'RCMAP_THROTTLE',
  },
  yaw: {
    fn: 'yaw',
    label: 'Yaw',
    maxDirection: 'all the way right',
    minDirection: 'all the way left',
    centered: true,
    stick: 'left',
    axis: 'x',
    sense: 1,
    rcmapParam: 'RCMAP_YAW',
  },
  roll: {
    fn: 'roll',
    label: 'Roll',
    maxDirection: 'all the way right',
    minDirection: 'all the way left',
    centered: true,
    stick: 'right',
    axis: 'x',
    sense: 1,
    rcmapParam: 'RCMAP_ROLL',
  },
  pitch: {
    fn: 'pitch',
    label: 'Pitch',
    // Back, not forward: see the sign derivation above.
    maxDirection: 'all the way back, toward you',
    minDirection: 'all the way forward, away from you',
    centered: true,
    stick: 'right',
    axis: 'y',
    // Down the screen: toward the pilot, the opposite of throttle's push away.
    sense: -1,
    rcmapParam: 'RCMAP_PITCH',
  },
}

export type Direction = 'max' | 'min'

export interface IdentifyStep {
  fn: StickFunction
  direction: Direction
}

/**
 * Every stick both ways, QGroundControl's walk: the max direction identifies
 * the channel and its reversal, the min direction confirms it -- the same
 * channel has to go the other way -- and between them they capture the
 * stick's endpoints, so the sweep afterwards is only for switches and dials.
 *
 * **The order keeps the throttle up for yaw.** Throttle down with yaw right is
 * ArduPilot's rudder-arm gesture -- measured against SITL: both Copter and
 * Plane armed from it in a few seconds, calibration or no calibration, since
 * the wizard tells the vehicle nothing. So the throttle goes up first and
 * stays up through both yaw steps, then comes down before roll and pitch,
 * which are no part of the gesture. Only for the mapping the vehicle holds,
 * though: the firmware reads the gesture through its current RCMAP_* and
 * endpoints, so on a radio miswired badly enough some other pair of sticks
 * is the one that arms. The props-off checklist is what covers that.
 */
export const IDENTIFY_STEPS: readonly IdentifyStep[] = [
  { fn: 'throttle', direction: 'max' },
  { fn: 'yaw', direction: 'max' },
  { fn: 'yaw', direction: 'min' },
  { fn: 'throttle', direction: 'min' },
  { fn: 'roll', direction: 'max' },
  { fn: 'roll', direction: 'min' },
  { fn: 'pitch', direction: 'max' },
  { fn: 'pitch', direction: 'min' },
]

/** How far back from its top the throttle must come to count as down again. */
export const RETURN_FRACTION = 0.8

/**
 * Whether the stick a max step identified has now gone the other way.
 *
 * A centered stick must cross its center by the same margin a max step needs,
 * the opposite way. The throttle has no center -- it began at the bottom -- so
 * it must come most of the way back down from the top it reached. Only the
 * expected channel is read: moving some other stick leaves this false, which
 * is how a max step that caught the wrong stick shows itself.
 */
export function reachedMin(
  spec: StickSpec,
  m: Mapping,
  reference: readonly number[],
  travel: readonly Travel[],
  now: readonly number[],
): boolean {
  const i = m.channel - 1
  const ref = reference[i]
  const v = now[i]
  if (!ref || !v) return false
  // The pulse-width direction the max went, so a reversed channel reads alike.
  const up = m.reversed ? -1 : 1
  if (spec.centered) return (v - ref) * up <= -MIN_DEFLECTION_US
  const t = travel[i]
  if (!t) return false
  const top = up > 0 ? t.max : t.min
  const span = (top - ref) * up
  return span >= MIN_DEFLECTION_US && (top - v) * up >= RETURN_FRACTION * span
}

/** A stick has to move at least this far from center to count as deflected. */
export const MIN_DEFLECTION_US = 180
/** ...and beat the next-liveliest channel by this much, so a twitchy channel
 *  or a bit of trim drift cannot win the vote. */
export const DEFLECTION_MARGIN_US = 90
/** A channel that never moved this far was not exercised at all. */
export const MIN_TRAVEL_US = 200

export interface Deflection {
  /** 1-based, as the parameters number them. */
  channel: number
  /** Signed microseconds away from the reference sample. */
  delta: number
}

/**
 * Which channel the user just moved, relative to a centered reference.
 *
 * Returns null while nothing is clearly deflected -- the wizard uses that to
 * keep its Next button disabled rather than guessing from noise.
 *
 * Channels already claimed by an earlier step are skipped. Without that, a
 * throttle left sitting at the top still reads as the largest deflection when
 * the next stick is asked for, and wins every remaining step: the throttle
 * has no spring to return it, so this is the normal way to hold a
 * transmitter rather than an unusual mistake.
 */
export function detectDeflection(
  reference: readonly number[],
  now: readonly number[],
  exclude: ReadonlySet<number> = new Set(),
  minDeflection = MIN_DEFLECTION_US,
  margin = DEFLECTION_MARGIN_US,
): Deflection | null {
  let best: Deflection | null = null
  let runnerUp = 0
  for (let i = 0; i < now.length; i++) {
    const ref = reference[i]
    const value = now[i]
    // A channel reading zero is not connected; a missing reference means the
    // channel appeared after the baseline was taken, so it cannot be judged.
    if (!ref || !value) continue
    if (exclude.has(i + 1)) continue
    const delta = value - ref
    const size = Math.abs(delta)
    if (!best || size > Math.abs(best.delta)) {
      runnerUp = best ? Math.abs(best.delta) : runnerUp
      best = { channel: i + 1, delta }
    } else if (size > runnerUp) {
      runnerUp = size
    }
  }
  if (!best || Math.abs(best.delta) < minDeflection) return null
  if (Math.abs(best.delta) - runnerUp < margin) return null
  return best
}

export interface Mapping {
  channel: number
  /** True when the max direction produced a *lower* pulse width. */
  reversed: boolean
}

/** What one identify step concluded. */
export function mappingFromDeflection(d: Deflection): Mapping {
  return { channel: d.channel, reversed: d.delta < 0 }
}

export interface Travel {
  min: number
  max: number
}

/** Per-channel extremes, indexed from zero, as gathered during the sweep. */
export function updateTravel(travel: Travel[], sample: readonly number[]): Travel[] {
  const out = travel.slice()
  sample.forEach((v, i) => {
    if (!v) return
    const t = out[i]
    out[i] = t ? { min: Math.min(t.min, v), max: Math.max(t.max, v) } : { min: v, max: v }
  })
  return out
}

export interface CalibrationResult {
  mapping: Partial<Record<StickFunction, Mapping>>
  travel: Travel[]
  /** The centered sample taken at the start, which is also the trims. */
  centers: number[]
}

/** Channels already assigned to a stick, so later steps can skip them. */
export function claimedChannels(mapping: Partial<Record<StickFunction, Mapping>>): Set<number> {
  const out = new Set<number>()
  for (const fn of STICK_FUNCTIONS) {
    const m = mapping[fn]
    if (m) out.add(m.channel)
  }
  return out
}

/** Functions that ended up sharing a channel -- the user moved the wrong stick. */
export function conflictingFunctions(
  mapping: Partial<Record<StickFunction, Mapping>>,
): StickFunction[] {
  const seen = new Map<number, StickFunction[]>()
  for (const fn of STICK_FUNCTIONS) {
    const m = mapping[fn]
    if (!m) continue
    const list = seen.get(m.channel) ?? []
    list.push(fn)
    seen.set(m.channel, list)
  }
  return [...seen.values()].filter((l) => l.length > 1).flat()
}

/** Channels that moved far enough during the sweep to have real endpoints. */
export function exercisedChannels(travel: readonly Travel[]): number[] {
  const out: number[] = []
  travel.forEach((t, i) => {
    if (t && t.max - t.min >= MIN_TRAVEL_US) out.push(i + 1)
  })
  return out
}

export interface ParamWrite {
  param: string
  value: number
}

/**
 * The parameters this calibration would write, in the order they should go.
 *
 * Endpoints first, then the mapping: RCMAP_* needs a reboot to take effect,
 * so it reads better as the last thing that changed.
 */
export function buildWrites(result: CalibrationResult): ParamWrite[] {
  const writes: ParamWrite[] = []
  const throttleChannel = result.mapping.throttle?.channel

  for (const channel of exercisedChannels(result.travel)) {
    const t = result.travel[channel - 1]
    if (!t) continue
    writes.push({ param: `RC${channel}_MIN`, value: Math.round(t.min) })
    writes.push({ param: `RC${channel}_MAX`, value: Math.round(t.max) })
    // Throttle has no neutral -- ArduPilot reads it as a range from MIN to
    // MAX -- so its trim goes to the bottom of that range rather than to
    // wherever the stick happened to be resting.
    const center = result.centers[channel - 1]
    const trim = channel === throttleChannel ? t.min : center
    if (trim && trim > 0) writes.push({ param: `RC${channel}_TRIM`, value: Math.round(trim) })
  }

  for (const fn of STICK_FUNCTIONS) {
    const m = result.mapping[fn]
    if (!m) continue
    writes.push({ param: `RC${m.channel}_REVERSED`, value: m.reversed ? 1 : 0 })
  }
  for (const fn of STICK_FUNCTIONS) {
    const m = result.mapping[fn]
    if (!m) continue
    writes.push({ param: STICK_SPECS[fn].rcmapParam, value: m.channel })
  }
  return writes
}

export type StageId = 'intro' | 'center' | 'identify' | 'sweep' | 'review'
