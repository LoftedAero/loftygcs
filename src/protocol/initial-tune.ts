// Initial tune parameters, from propeller size and battery cell count.
//
// Mission Planner has this as Setup > Mandatory Hardware > Initial Parameter
// Setup, and it is the one thing on that screen with no equivalent here: a
// new multirotor flies badly on defaults because the defaults cannot know how
// big it is, and the numbers that matter are a short arithmetic away from two
// facts the builder already knows.
//
// **Every value here is ArduPilot's own, from "Setting the Aircraft Up for
// Tuning" (ardupilot.org/copter/docs/setting-up-for-tuning.html).** The wiki
// publishes anchors at particular propeller sizes rather than formulas, so the
// anchors are reproduced verbatim below and anything between them is
// interpolated -- which is this app's arithmetic, not ArduPilot's, and is why
// `initialTuneParams` is a pure function with the anchors pinned in a test.
//
// Three things are deliberately *not* computed, because the wiki does not give
// a value that can be derived from these two inputs:
//
//   - the rate and angle PID gains. "The PID controller default values for
//     axis P/D/I values are usually safe for first test hovers", so a number
//     invented here would be worse than the default it replaced.
//   - MOT_SPIN_ARM and MOT_SPIN_MIN, which the wiki says to find with the
//     motor test, on the actual aircraft.
//   - MOT_PWM_MIN/MAX, which belong to the ESC rather than to the airframe.

export interface TuneInputs {
  /** Propeller diameter, inches. */
  propInches: number
  /** Cells in series. */
  cells: number
}

export interface TuneValue {
  param: string
  value: number
}

/** Volts per cell at full charge and empty, for a standard LiPo. */
const CELL_FULL = 4.2
const CELL_EMPTY = 3.3

/**
 * Interpolate between published points, flat outside them.
 *
 * Flat rather than extrapolated on purpose: past the ends of the table the
 * trend is not something the wiki claims, and a straight line off the end of
 * this data reaches zero and then negative.
 */
function fromAnchors(d: number, anchors: readonly (readonly [number, number])[]): number {
  const first = anchors[0]!
  const last = anchors[anchors.length - 1]!
  if (d <= first[0]) return first[1]
  if (d >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]!
    const [x0, y0] = anchors[i - 1]!
    if (d <= x1) return y0 + ((y1 - y0) * (d - x0)) / (x1 - x0)
  }
  return last[1]
}

/** "0.55 for 5 inch props, 0.65 for 10 inch props, 0.75 for 20 inch props". */
const THRUST_EXPO = [
  [5, 0.55],
  [10, 0.65],
  [20, 0.75],
] as const

/** "1100 for 10 inch props, 500 for 20 inch props, 200 for 30 inch props". */
const ACCEL_RP = [
  [10, 1100],
  [20, 500],
  [30, 200],
] as const

/** "200 for 10 inch props, 100 for 20 inch props, 90 for 30 inch props". */
const ACCEL_YAW = [
  [10, 200],
  [20, 100],
  [30, 90],
] as const

/**
 * The gyro filter, in Hz.
 *
 * The wiki gives 80Hz at 5in, 40Hz at 10in and 20Hz at 20in, which is exactly
 * 400/diameter at all three points -- so the law is used rather than the three
 * points, and it keeps meaning something past the end of the table. Floored at
 * 10Hz, which is where the accelerometer filter sits.
 */
export function gyroFilterHz(propInches: number): number {
  return Math.max(10, Math.round(400 / Math.max(1, propInches)))
}

/** Round to a sensible number of decimals for a parameter of this size. */
function tidy(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/**
 * What to set for an aircraft of this size on this battery.
 *
 * Returned in the order a reader would check them: what the battery is, what
 * the motors do, then what the controller is allowed to ask for.
 */
/**
 * The two places these parameters live.
 *
 * A multirotor carries them as MOT_* and ATC_*; a quadplane carries the same
 * set for its VTOL motors as Q_M_* and Q_A_*, one for one -- measured on a
 * quadplane SITL, which is also where the short `ACC` spelling was confirmed
 * for both (Copter 4.7.1 has ATC_ACC_R_MAX and nothing matching ATC_ACCEL).
 * A pure fixed wing has neither family and keeps only the INS filters.
 *
 * Both are emitted and the caller keeps whatever the vehicle reports, which
 * is the same trick the Identity card uses for the MAV_SYSID rename: it needs
 * no vehicle-type test here, and the arithmetic is about propeller size,
 * which does not care which airframe the motors are bolted to.
 */
const FAMILIES = [
  { motors: 'MOT_', attitude: 'ATC_' },
  { motors: 'Q_M_', attitude: 'Q_A_' },
] as const

export function initialTuneParams({ propInches, cells }: TuneInputs): TuneValue[] {
  const gyro = gyroFilterHz(propInches)
  const rateFilter = tidy(gyro / 2, 1)
  const accelRP = Math.round(fromAnchors(propInches, ACCEL_RP))
  const accelYaw = Math.round(fromAnchors(propInches, ACCEL_YAW))
  const expo = tidy(fromAnchors(propInches, THRUST_EXPO), 2)

  const out: TuneValue[] = []
  for (const { motors } of FAMILIES) {
    out.push(
      { param: `${motors}BAT_VOLT_MAX`, value: tidy(CELL_FULL * cells, 2) },
      { param: `${motors}BAT_VOLT_MIN`, value: tidy(CELL_EMPTY * cells, 2) },
      { param: `${motors}THST_EXPO`, value: expo },
      // "0.25 or below the expected actual hover thrust percentage" -- the
      // vehicle learns the real figure in flight from here.
      { param: `${motors}THST_HOVER`, value: 0.25 },
      { param: `${motors}SPIN_MAX`, value: 0.95 },
    )
  }
  // The inertial sensors are the one part every vehicle shares, fixed wings
  // included.
  out.push({ param: 'INS_ACCEL_FILTER', value: 10 }, { param: 'INS_GYRO_FILTER', value: gyro })
  for (const { attitude } of FAMILIES) {
    out.push(
      { param: `${attitude}ACC_R_MAX`, value: accelRP },
      { param: `${attitude}ACC_P_MAX`, value: accelRP },
      { param: `${attitude}ACC_Y_MAX`, value: accelYaw },
      // Every rate filter is half the gyro filter; the yaw error filter is
      // the one fixed number in the set.
      { param: `${attitude}RAT_RLL_FLTD`, value: rateFilter },
      { param: `${attitude}RAT_RLL_FLTT`, value: rateFilter },
      { param: `${attitude}RAT_PIT_FLTD`, value: rateFilter },
      { param: `${attitude}RAT_PIT_FLTT`, value: rateFilter },
      { param: `${attitude}RAT_YAW_FLTT`, value: rateFilter },
      { param: `${attitude}RAT_YAW_FLTE`, value: 2 },
    )
  }
  // The long ATC_ACCEL_* spelling older builds used, kept so a 4.5 vehicle
  // still gets its limits.
  out.push(
    { param: 'ATC_ACCEL_R_MAX', value: accelRP },
    { param: 'ATC_ACCEL_P_MAX', value: accelRP },
    { param: 'ATC_ACCEL_Y_MAX', value: accelYaw },
  )
  return out
}

/**
 * Does this vehicle have multirotor motors to tune at all?
 *
 * The thrust curve is the marker: a fixed wing has no thrust expo under
 * either family, and nothing else in the set is worth a card of its own.
 */
export function hasTunableMotors(has: (param: string) => boolean): boolean {
  return FAMILIES.some((f) => has(`${f.motors}THST_EXPO`))
}

/** Every parameter the initial tune ever sets, for a card that owns them. */
const TUNE_PARAMS: ReadonlySet<string> = new Set(
  initialTuneParams({ propInches: 10, cells: 4 }).map((v) => v.param),
)

/**
 * Is this one of ours?
 *
 * The set does not depend on the inputs -- only the values do -- so one call
 * names every parameter this card can stage, whichever family the vehicle
 * turns out to have.
 */
export function isInitialTuneParam(param: string): boolean {
  return TUNE_PARAMS.has(param)
}
