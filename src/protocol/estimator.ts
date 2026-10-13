// Which attitude and position estimator the vehicle is flying on, and how
// healthy it is.
//
// MAVLink has no field naming the active estimator, so this is pieced
// together from three signals (ArduPilot's AP_AHRS, read in source):
//
//   - "AHRS: EKF3 active" (or EKF2, DCM, SIM, External) is sent each time the
//     active estimator changes, and only then. Exact, but a GCS that connects
//     later never hears it.
//   - The SYS_STATUS AHRS health bit is set only while the estimator chosen in
//     AHRS_EKF_TYPE is the active one *and* healthy (AP_AHRS::healthy() fails
//     whenever the active backend differs from the configured one). It is sent
//     continuously, but clear is ambiguous: a fallback, or an unhealthy EKF.
//   - EKF_STATUS_REPORT describes the *configured* estimator, so it cannot say
//     which one is in charge; its flags still say how the EKF is doing.
//
// So the label is never a name the signals cannot back: the configured
// estimator while the bit says it is active, the announced one when the bit
// is clear and an announcement was heard, and otherwise the configured one,
// in red, which is the honest "not healthy, or fallen back".

import type { EkfStatus } from './types'

/** AHRS_EKF_TYPE values, which are also ArduPilot's EKFType enum. */
const ESTIMATOR_NAMES: Record<number, string> = {
  0: 'DCM',
  2: 'EKF2',
  3: 'EKF3',
  10: 'SIM',
  11: 'External',
}

/** The name ArduPilot uses for an AHRS_EKF_TYPE value. */
export function estimatorName(ahrsEkfType: number | undefined): string {
  return (ahrsEkfType !== undefined && ESTIMATOR_NAMES[ahrsEkfType]) || 'EKF'
}

const ANNOUNCEMENT = /^AHRS: (\S+) active$/

/** The estimator a status text says just became active, or null. */
export function announcedEstimator(text: string): string | null {
  return ANNOUNCEMENT.exec(text.trim())?.[1] ?? null
}

// "EKF3 lane switch 1" (AP_NavEKF3) or "NavEKF2: lane switch 1" (AP_NavEKF2),
// sent once when the primary core changes in flight.
const LANE_SWITCH = /^(?:EKF3|NavEKF2:) lane switch (\d+)$/

/** The core a status text says just became primary, or null. */
export function laneSwitch(text: string): number | null {
  const m = LANE_SWITCH.exec(text.trim())
  return m ? Number(m[1]) : null
}

/**
 * The IMU each EKF core runs on, from EK3_IMU_MASK (or EK2_IMU_MASK): one core
 * per set bit, in bit order, so core 0 is the lowest IMU in the mask.
 */
export function coreImus(imuMask: number | undefined): number[] {
  if (imuMask === undefined) return []
  const imus: number[] = []
  for (let i = 0; i < 8; i++) if (imuMask & (1 << i)) imus.push(i)
  return imus
}

/**
 * Whether a status text starts or clears the vehicle's EKF failsafe, else null.
 * Copter sends "EKF variance: position lost" and "EKF Failsafe", then "EKF
 * Failsafe Cleared"; Rover the same in lower case; Plane only "EKF variance",
 * with no clearing message at all -- which is why the latch is also dropped
 * when the heartbeat leaves the failsafe states (see `isFailsafeState`).
 */
export function ekfFailsafeChange(text: string): boolean | null {
  const t = text.trim()
  if (/^EKF failsafe cleared/i.test(t)) return false
  if (/^EKF variance/.test(t) || /^EKF failsafe/i.test(t)) return true
  return null
}

/** MAV_STATE CRITICAL (5) or EMERGENCY (6): ArduPilot's "a failsafe is active". */
export function isFailsafeState(systemStatus: number): boolean {
  return systemStatus === 5 || systemStatus === 6
}

/** A status text that belongs in the estimator's own message history. */
export function isEstimatorMessage(text: string): boolean {
  return /^(EKF|NavEKF|AHRS)/.test(text.trim())
}

export interface VarianceDef {
  key: keyof Omit<EkfStatus, 'flags'>
  label: string
}

/** EKF_STATUS_REPORT's variances, in Mission Planner's order. */
export const VARIANCES: readonly VarianceDef[] = [
  { key: 'velocityVariance', label: 'Velocity' },
  { key: 'posHorizVariance', label: 'Horizontal position' },
  { key: 'posVertVariance', label: 'Vertical position' },
  { key: 'compassVariance', label: 'Compass' },
  { key: 'terrainAltVariance', label: 'Terrain altitude' },
  { key: 'airspeedVariance', label: 'Airspeed' },
]

/**
 * The estimator ArduPilot falls back to when the EKF is unhealthy
 * (AP_AHRS::fallback_active_EKF_type), on every build that has DCM.
 */
export const FALLBACK_ESTIMATOR = 'DCM'

/** EKF_STATUS_FLAGS bits ArduPilot sets (ardupilotmega.xml). */
export const EKF_FLAGS = {
  attitude: 1 << 0,
  velocityHoriz: 1 << 1,
  velocityVert: 1 << 2,
  posHorizRel: 1 << 3,
  posHorizAbs: 1 << 4,
  posVertAbs: 1 << 5,
  posVertAgl: 1 << 6,
  constPosMode: 1 << 7,
  predPosHorizRel: 1 << 8,
  predPosHorizAbs: 1 << 9,
  uninitialized: 1 << 10,
  gpsGlitching: 1 << 15,
} as const

/**
 * How a flag reads when set. 'good' flags are solutions the EKF has; 'warn'
 * and 'bad' are ArduPilot's own degraded states. A flag that is not set is
 * not judged: plenty of good setups have no height-above-ground solution.
 */
export type FlagKind = 'good' | 'warn' | 'bad'

export const FLAG_DEFS: readonly { bit: number; label: string; kind: FlagKind }[] = [
  { bit: EKF_FLAGS.attitude, label: 'Attitude', kind: 'good' },
  { bit: EKF_FLAGS.velocityHoriz, label: 'Horizontal velocity', kind: 'good' },
  { bit: EKF_FLAGS.velocityVert, label: 'Vertical velocity', kind: 'good' },
  { bit: EKF_FLAGS.posHorizRel, label: 'Horizontal position (relative)', kind: 'good' },
  { bit: EKF_FLAGS.posHorizAbs, label: 'Horizontal position (absolute)', kind: 'good' },
  { bit: EKF_FLAGS.posVertAbs, label: 'Vertical position', kind: 'good' },
  { bit: EKF_FLAGS.posVertAgl, label: 'Height above ground', kind: 'good' },
  { bit: EKF_FLAGS.predPosHorizRel, label: 'Predicted position (relative)', kind: 'good' },
  { bit: EKF_FLAGS.predPosHorizAbs, label: 'Predicted position (absolute)', kind: 'good' },
  { bit: EKF_FLAGS.constPosMode, label: 'Constant position mode', kind: 'warn' },
  { bit: EKF_FLAGS.gpsGlitching, label: 'GPS glitching', kind: 'warn' },
  { bit: EKF_FLAGS.uninitialized, label: 'Uninitialized', kind: 'bad' },
]

export type EstimatorTone = 'ok' | 'warn' | 'bad' | 'none'

export interface EstimatorIndicator {
  label: string
  tone: EstimatorTone
}

/**
 * The HUD's estimator pill. Color comes from the vehicle's own judgements, not
 * a threshold of this app's: red is ArduPilot's AHRS health bit clear or its
 * EKF failsafe in effect; amber is the EKF flagging GPS glitching or
 * constant-position mode (no position aid); grey is nothing reported yet.
 *
 * The failsafe needs its own input because the health bit does not cover it:
 * measured against SITL, losing GPS put Copter into EKF failsafe ("EKF
 * variance: position lost", heartbeat CRITICAL) with the AHRS bit still set.
 */
export function estimatorIndicator(input: {
  ahrsEkfType: number | undefined
  sensorsPresent: number
  sensorsHealth: number
  ahrsBit: number
  ekf: EkfStatus | null
  announced: string | null
  /** An EKF failsafe was announced and the heartbeat still says failsafe. */
  ekfFailsafe: boolean
}): EstimatorIndicator {
  const configured = estimatorName(input.ahrsEkfType)
  if ((input.sensorsPresent & input.ahrsBit) === 0) {
    return { label: configured, tone: 'none' }
  }
  if ((input.sensorsHealth & input.ahrsBit) === 0) {
    return { label: input.announced ?? configured, tone: 'bad' }
  }
  if (input.ekfFailsafe) return { label: configured, tone: 'bad' }
  const flags = input.ekf?.flags ?? 0
  const degraded = (flags & (EKF_FLAGS.gpsGlitching | EKF_FLAGS.constPosMode)) !== 0
  return { label: configured, tone: degraded ? 'warn' : 'ok' }
}
