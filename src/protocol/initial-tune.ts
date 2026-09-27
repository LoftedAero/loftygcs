// Initial tune parameters from propeller size and battery cell count, like
// Mission Planner's Initial Parameter Setup.
//
// Every value comes from ArduPilot's "Setting the Aircraft Up for Tuning"
// (ardupilot.org/copter/docs/setting-up-for-tuning.html). The wiki publishes
// values at particular propeller sizes; those anchors are reproduced verbatim
// and sizes between them are interpolated.
//
// Not computed, because the wiki gives nothing derivable from these inputs:
//   - rate and angle PID gains (the defaults "are usually safe for first test
//     hovers");
//   - MOT_SPIN_ARM and MOT_SPIN_MIN, found with the motor test;
//   - MOT_PWM_MIN/MAX, which belong to the ESC.

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
 * Interpolate between published points, flat outside them. Extrapolating
 * would claim a trend the wiki does not, and past 30in reaches negative values.
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
 * The gyro filter, in Hz. The wiki's 80Hz at 5in, 40Hz at 10in and 20Hz at
 * 20in are exactly 400/diameter, so that law is used. Floored at 10Hz, where
 * the accelerometer filter sits.
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
 * A multirotor carries these as MOT_* and ATC_*; a quadplane carries the same
 * set for its VTOL motors as Q_M_* and Q_A_*. A fixed wing has neither and
 * keeps only the INS filters. Both families are emitted and the caller keeps
 * whichever the vehicle reports, so no vehicle-type test is needed.
 */
const FAMILIES = [
  { motors: 'MOT_', attitude: 'ATC_' },
  { motors: 'Q_M_', attitude: 'Q_A_' },
] as const

/**
 * What to set for an aircraft of this size on this battery, in reading order:
 * battery, motors, then controller limits.
 */
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
      // "0.25 or below the expected actual hover thrust percentage"; the
      // vehicle learns the real figure in flight.
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
  // Older builds spell these ATC_ACCEL_*; Copter 4.7.1 uses ATC_ACC_*.
  out.push(
    { param: 'ATC_ACCEL_R_MAX', value: accelRP },
    { param: 'ATC_ACCEL_P_MAX', value: accelRP },
    { param: 'ATC_ACCEL_Y_MAX', value: accelYaw },
  )
  return out
}

/**
 * Does this vehicle have multirotor motors to tune? A fixed wing has no
 * thrust expo under either family.
 */
export function hasTunableMotors(has: (param: string) => boolean): boolean {
  return FAMILIES.some((f) => has(`${f.motors}THST_EXPO`))
}

/** Every parameter the initial tune ever sets, for a card that owns them. */
const TUNE_PARAMS: ReadonlySet<string> = new Set(
  initialTuneParams({ propInches: 10, cells: 4 }).map((v) => v.param),
)

/** Is this one of the initial tune's parameters? The set does not depend on the inputs. */
export function isInitialTuneParam(param: string): boolean {
  return TUNE_PARAMS.has(param)
}
