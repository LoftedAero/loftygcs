import { beforeEach, describe, expect, it } from 'vitest'
import { useVehicleStore } from './vehicle-store'

// The estimator facts ArduPilot says once, latched as the status feed goes
// past, and the EKF failsafe, which needs the heartbeat as well as the text.

const say = (text: string) =>
  useVehicleStore.getState().appendStatusText({ severity: 6, text, at: Date.now() })
const status = (systemStatus: number) => useVehicleStore.getState().apply({ systemStatus })

beforeEach(() => useVehicleStore.getState().reset())

describe('latched estimator facts', () => {
  it('keeps the last active estimator announced', () => {
    say('AHRS: DCM active')
    say('EKF3 IMU0 is using GPS')
    expect(useVehicleStore.getState().estimatorAnnounced).toBe('DCM')
    say('AHRS: EKF3 active')
    expect(useVehicleStore.getState().estimatorAnnounced).toBe('EKF3')
  })

  it('keeps the last primary core announced', () => {
    say('EKF3 lane switch 1')
    say('EKF3 IMU1 is using GPS')
    expect(useVehicleStore.getState().ekfPrimaryCore).toBe(1)
  })

  it('forgets both with the vehicle', () => {
    say('AHRS: DCM active')
    say('EKF3 lane switch 1')
    useVehicleStore.getState().reset()
    expect(useVehicleStore.getState().estimatorAnnounced).toBeNull()
    expect(useVehicleStore.getState().ekfPrimaryCore).toBeNull()
  })
})

describe('the EKF failsafe latch', () => {
  it('survives the text arriving before the heartbeat turns CRITICAL', () => {
    status(3) // standby
    say('EKF variance: position lost')
    status(3) // the next snapshot, still from the old heartbeat
    expect(useVehicleStore.getState().ekfFailsafe).toBe(true)
    status(5) // critical
    expect(useVehicleStore.getState().ekfFailsafe).toBe(true)
  })

  it('clears when the heartbeat leaves the failsafe states (Plane sends no text)', () => {
    status(5)
    say('EKF variance')
    status(3)
    expect(useVehicleStore.getState().ekfFailsafe).toBe(false)
  })

  it('clears on Copter and Rover clearing texts', () => {
    status(5)
    say('EKF variance: position lost')
    say('EKF Failsafe Cleared')
    expect(useVehicleStore.getState().ekfFailsafe).toBe(false)
  })
})
