import { describe, expect, it } from 'vitest'
import {
  announcedEstimator,
  coreImus,
  EKF_FLAGS,
  ekfFailsafeChange,
  estimatorIndicator,
  estimatorName,
  isEstimatorMessage,
  isFailsafeState,
  laneSwitch,
} from './estimator'
import type { EkfStatus } from './types'

const AHRS = 1 << 21

function ekf(flags = 0): EkfStatus {
  return {
    flags,
    velocityVariance: 0.01,
    posHorizVariance: 0.01,
    posVertVariance: 0,
    compassVariance: 0.01,
    terrainAltVariance: 0,
    airspeedVariance: 0,
  }
}

/** A healthy EKF3 vehicle, with one field changed per test. */
function indicator(over: Partial<Parameters<typeof estimatorIndicator>[0]> = {}) {
  return estimatorIndicator({
    ahrsEkfType: 3,
    sensorsPresent: AHRS,
    sensorsHealth: AHRS,
    ahrsBit: AHRS,
    ekf: ekf(EKF_FLAGS.attitude),
    announced: null,
    ekfFailsafe: false,
    ...over,
  })
}

describe('estimatorName', () => {
  it("uses ArduPilot's names for AHRS_EKF_TYPE", () => {
    expect(estimatorName(0)).toBe('DCM')
    expect(estimatorName(2)).toBe('EKF2')
    expect(estimatorName(3)).toBe('EKF3')
    expect(estimatorName(10)).toBe('SIM')
    expect(estimatorName(11)).toBe('External')
  })

  it('says only EKF when the parameter is unknown or not downloaded', () => {
    expect(estimatorName(undefined)).toBe('EKF')
    expect(estimatorName(7)).toBe('EKF')
  })
})

describe('the status texts ArduPilot sends once', () => {
  it('reads the active estimator from "AHRS: X active"', () => {
    expect(announcedEstimator('AHRS: EKF3 active')).toBe('EKF3')
    expect(announcedEstimator('AHRS: DCM active')).toBe('DCM')
    expect(announcedEstimator('AHRS: not using configured AHRS type')).toBeNull()
  })

  it('reads a primary core switch from both EKF generations', () => {
    expect(laneSwitch('EKF3 lane switch 1')).toBe(1)
    expect(laneSwitch('NavEKF2: lane switch 0')).toBe(0)
    expect(laneSwitch('EKF3 IMU1 is using GPS')).toBeNull()
  })

  it('starts the EKF failsafe on Copter, Plane and Rover wording, and clears it on theirs', () => {
    expect(ekfFailsafeChange('EKF variance: position lost')).toBe(true) // Copter
    expect(ekfFailsafeChange('EKF Failsafe')).toBe(true) // Copter
    expect(ekfFailsafeChange('EKF variance')).toBe(true) // Plane, Rover
    expect(ekfFailsafeChange('EKF failsafe')).toBe(true) // Rover
    expect(ekfFailsafeChange('EKF Failsafe Cleared')).toBe(false) // Copter
    expect(ekfFailsafeChange('EKF failsafe cleared')).toBe(false) // Rover
    expect(ekfFailsafeChange('EKF3 IMU0 initialised')).toBeNull()
  })

  it('keeps EKF and AHRS chatter for the history, and nothing else', () => {
    expect(isEstimatorMessage('EKF3 IMU0 is using GPS')).toBe(true)
    expect(isEstimatorMessage('NavEKF2: lane switch 0')).toBe(true)
    expect(isEstimatorMessage('AHRS: EKF3 active')).toBe(true)
    expect(isEstimatorMessage('PreArm: Compass not calibrated')).toBe(false)
  })
})

describe('isFailsafeState', () => {
  it('is MAV_STATE CRITICAL or EMERGENCY only', () => {
    expect(isFailsafeState(5)).toBe(true)
    expect(isFailsafeState(6)).toBe(true)
    expect(isFailsafeState(3)).toBe(false) // standby
    expect(isFailsafeState(4)).toBe(false) // active
  })
})

describe('coreImus', () => {
  it('gives each core the IMU of a set bit, lowest first', () => {
    expect(coreImus(3)).toEqual([0, 1])
    expect(coreImus(0b101)).toEqual([0, 2])
    expect(coreImus(undefined)).toEqual([])
  })
})

describe('estimatorIndicator', () => {
  it('is the configured EKF in green while the AHRS bit is set', () => {
    expect(indicator()).toEqual({ label: 'EKF3', tone: 'ok' })
  })

  it('is grey while the vehicle has not reported its AHRS', () => {
    expect(indicator({ sensorsPresent: 0 })).toEqual({ label: 'EKF3', tone: 'none' })
  })

  it('names the announced fallback in red when the bit is clear', () => {
    expect(indicator({ sensorsHealth: 0, announced: 'DCM' })).toEqual({
      label: 'DCM',
      tone: 'bad',
    })
  })

  it('claims nothing it cannot back when the bit is clear and nothing was announced', () => {
    // Fallen back or unhealthy, which one unknown: the configured name, in red.
    expect(indicator({ sensorsHealth: 0 })).toEqual({ label: 'EKF3', tone: 'bad' })
  })

  it('is red during an EKF failsafe even with the AHRS bit still set', () => {
    // Measured on Copter SITL: GPS lost, failsafe declared, AHRS bit unchanged.
    expect(indicator({ ekfFailsafe: true })).toEqual({ label: 'EKF3', tone: 'bad' })
  })

  it('is amber when the EKF flags GPS glitching or constant-position mode', () => {
    const glitch = ekf(EKF_FLAGS.attitude | EKF_FLAGS.gpsGlitching)
    const constPos = ekf(EKF_FLAGS.attitude | EKF_FLAGS.constPosMode)
    expect(indicator({ ekf: glitch }).tone).toBe('warn')
    expect(indicator({ ekf: constPos }).tone).toBe('warn')
  })

  it('lets red outrank amber', () => {
    const glitch = ekf(EKF_FLAGS.gpsGlitching)
    expect(indicator({ ekf: glitch, sensorsHealth: 0 }).tone).toBe('bad')
    expect(indicator({ ekf: glitch, ekfFailsafe: true }).tone).toBe('bad')
  })
})
