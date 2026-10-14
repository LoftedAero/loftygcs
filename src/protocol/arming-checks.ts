// ArduPilot's arming checks, and which one a PreArm message came from.
//
// The firmware knows each failure's category (AP_Arming::Check) but drops it
// on the way out: STATUSTEXT carries only "PreArm: Compass 1 not healthy". So
// the category is recovered from the wording, matched against the format
// strings AP_Arming and the vehicles pass to check_failed(). Where a check
// forwards a subsystem's own message ("%s"), the subsystem's prefix is
// matched instead. Anything unmatched is 'other', which is also where the
// mandatory checks that ignore ARMING_SKIPCHK land -- an unrecognized failure
// must still appear somewhere.
//
// Bits and labels are ArduPilot's own (AP_Arming.h, ARMING_SKIPCHK's
// @Bitmask). They kept their positions when 4.7 replaced ARMING_CHECK (bits to
// run, bit 0 = all) with ARMING_SKIPCHK (bits to skip).

export interface ArmingCheck {
  bit: number
  label: string
  /** Only shown on these vehicles; absent means every vehicle. */
  vehicles?: readonly ('plane' | 'other')[]
}

export const ARMING_CHECKS: readonly ArmingCheck[] = [
  { bit: 1, label: 'Barometer' },
  { bit: 2, label: 'Compass' },
  { bit: 3, label: 'GPS lock' },
  { bit: 4, label: 'INS' },
  { bit: 5, label: 'Parameters' },
  { bit: 6, label: 'RC Channels' },
  { bit: 7, label: 'Board voltage' },
  { bit: 8, label: 'Battery Level' },
  { bit: 9, label: 'Airspeed', vehicles: ['plane'] },
  { bit: 10, label: 'Logging Available' },
  { bit: 11, label: 'Hardware safety switch' },
  { bit: 12, label: 'GPS Configuration' },
  { bit: 13, label: 'System' },
  { bit: 14, label: 'Mission' },
  { bit: 15, label: 'Rangefinder' },
  { bit: 16, label: 'Camera' },
  { bit: 17, label: 'AuxAuth' },
  { bit: 18, label: 'VisualOdometry', vehicles: ['other'] },
  { bit: 19, label: 'FFT' },
]

/** First match wins, so the specific patterns sit above the general ones. */
const PATTERNS: readonly [RegExp, number][] = [
  // Board voltage owns "Battery failsafe"; Battery Level owns the rest.
  [/^Battery failsafe/, 7],
  [/^Board \(|^Servo voltage/, 7],
  [/^Battery/, 8],
  [/^Airspeed/, 9],
  [/^Baro|^Altitude disparity/, 1],
  [/^Compass|^Check mag field/, 2],
  [
    /^GPS_AUTO_SWITCH|^GPS (\d|positions|and AHRS|blending)|^High GPS HDOP|^AHRS: waiting for home/,
    3,
  ],
  [/^GPS/, 3],
  [/^AHRS|^EKF|^Accels?|^Gyros?|^3D Accel|^Leaning|^temperature cal|^Batch sampling/, 4],
  [
    /^RC|^Radio failsafe|^VTOL Fwd Throttle| below failsafe$| radio (max|min) too| is not neutral$| too high$/,
    6,
  ],
  [/^Logging|^No SD card|^Downloading logs/, 10],
  [/^Safety Switch/, 11],
  [
    /^Mission|^Mode requires mission|^Missing mission item|^DO_(LAND|RETURN_PATH)_START|rally|^VTOL land too short|^Failed to open/,
    14,
  ],
  [/^Rangefinder|^RNGFND/, 15],
  [/^Mount|^Camera/, 16],
  [/auxiliary authori|^Waiting for auxiliary/i, 17],
  [/^VisOdom/, 18],
  [/^FFT/, 19],
  [
    /^DroneCAN|^PiccoloCAN|^Main loop slow|^heater temp|^Param storage failed|^Terrain out of memory|^ADSB out of memory|^Same rfnd/,
    13,
  ],
  [
    /^Bad parameter|^Check (ACRO|FS_THR|PILOT)|^CrashDump|^Duplicate Aux|^FS_GCS_ENABLE|^Invalid MultiCopter|^Mode channel and RC|^Motor Interlock|^parameter storage full|^Proximity|^set (Q_FWD|TAILSIT)|^(tailsitter|tiltrotor) setup|^terrain (disabled|required)|^unset one of|^WP_SPEED|^ADSB threat/,
    5,
  ],
]

/** The check a PreArm reason (prefix already removed) belongs to, or null. */
export function checkForReason(reason: string): number | null {
  for (const [re, bit] of PATTERNS) if (re.test(reason)) return bit
  return null
}

/**
 * Whether ArduPilot will skip a check, from whichever parameter the firmware
 * has. Null when neither has downloaded, so nothing is claimed.
 */
export function isSkipped(
  bit: number,
  skipchk: number | undefined,
  armingCheck: number | undefined,
): boolean | null {
  if (skipchk !== undefined) return skipchk === -1 || (skipchk & (1 << bit)) !== 0
  if (armingCheck !== undefined) return (armingCheck & 1) === 0 && (armingCheck & (1 << bit)) === 0
  return null
}

export type CheckStatus = 'pass' | 'fail' | 'skipped' | 'unknown'

export interface CheckRow {
  bit: number | null
  label: string
  status: CheckStatus
  /** The vehicle's own words for each failure in this check. */
  reasons: string[]
}

/**
 * One row per check, plus 'Other' for reasons no check claims.
 *
 * A check with no current reason is a pass only when the vehicle has said
 * something either way: the prearm bit reads ready, or reasons are being
 * reported. Not ready with nothing heard yet is unknown, not a pass.
 *
 * The prearm bit outranks the reasons. They are kept for a minute because
 * ArduPilot repeats them only every thirty seconds, so one sent just before
 * the vehicle became ready would otherwise fail a check beside "Ready to arm".
 */
export function checkRows(
  reasons: readonly string[],
  vehicle: 'plane' | 'other',
  skipchk: number | undefined,
  armingCheck: number | undefined,
  readiness: 'armed' | 'ready' | 'notReady' | 'unknown',
): CheckRow[] {
  const byBit = new Map<number | null, string[]>()
  const current = readiness === 'ready' || readiness === 'armed' ? [] : reasons
  for (const r of current) {
    const bit = checkForReason(r)
    byBit.set(bit, [...(byBit.get(bit) ?? []), r])
  }
  const heard = readiness === 'ready' || readiness === 'armed' || reasons.length > 0
  const rows: CheckRow[] = ARMING_CHECKS.filter(
    (c) => !c.vehicles || c.vehicles.includes(vehicle),
  ).map((c) => {
    const failing = byBit.get(c.bit) ?? []
    const skipped = isSkipped(c.bit, skipchk, armingCheck)
    const status: CheckStatus =
      skipped === true ? 'skipped' : failing.length > 0 ? 'fail' : heard ? 'pass' : 'unknown'
    return { bit: c.bit, label: c.label, status, reasons: failing }
  })
  const other = byBit.get(null) ?? []
  rows.push({
    bit: null,
    label: 'Other',
    status: other.length > 0 ? 'fail' : heard ? 'pass' : 'unknown',
    reasons: other,
  })
  return rows
}
