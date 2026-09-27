import { describe, expect, it } from 'vitest'
import { SENSOR_BITS, decodeSensors, unhealthySensors } from './sensors'

const GYRO = SENSOR_BITS.gyro
const ACCEL = SENSOR_BITS.accel
const MAG = SENSOR_BITS.mag
const GPS = SENSOR_BITS.gps

// "Not fitted" is normal for an airframe; "fitted and failing" grounds it.
describe('decodeSensors', () => {
  it('lists only sensors the board says are fitted', () => {
    const readings = decodeSensors(GYRO | ACCEL, GYRO | ACCEL, GYRO | ACCEL)
    expect(readings.map((r) => r.id)).toEqual(['gyro', 'accel'])
    // No airspeed sensor, so it is absent rather than reported as broken.
    expect(readings.some((r) => r.id === 'airspeed')).toBe(false)
  })

  it('separates healthy, unhealthy and disabled', () => {
    const present = GYRO | ACCEL | MAG | GPS
    const enabled = GYRO | ACCEL | GPS // compass fitted but switched off
    const health = GYRO | ACCEL // GPS enabled but not healthy
    const byId = Object.fromEntries(
      decodeSensors(present, enabled, health).map((r) => [r.id, r.state]),
    )
    expect(byId.gyro).toBe('healthy')
    expect(byId.accel).toBe('healthy')
    expect(byId.mag).toBe('disabled')
    expect(byId.gps).toBe('unhealthy')
  })

  it('picks out what is actually failing', () => {
    const readings = decodeSensors(GYRO | GPS, GYRO | GPS, GYRO)
    expect(unhealthySensors(readings).map((r) => r.id)).toEqual(['gps'])
  })

  it('reports nothing before the vehicle has spoken', () => {
    expect(decodeSensors(0, 0, 0)).toEqual([])
  })

  it('keeps a stable display order regardless of bit order', () => {
    const all = Object.values(SENSOR_BITS).reduce((a, b) => a | b, 0)
    const ids = decodeSensors(all, all, all).map((r) => r.id)
    expect(ids.indexOf('gyro')).toBeLessThan(ids.indexOf('gps'))
    expect(ids.indexOf('gps')).toBeLessThan(ids.indexOf('geofence'))
  })

  it('never lists the prearm flag as a sensor', () => {
    // MAV_SYS_STATUS_PREARM_CHECK reports whether arming checks pass; it is
    // not a device, and listing it as unhealthy reads as broken hardware.
    const all = Object.values(SENSOR_BITS).reduce((a, b) => a | b, 0)
    expect(decodeSensors(all, all, all).map((r) => r.id)).not.toContain('prearm')
    // Including when it is failing.
    const healthy = all & ~SENSOR_BITS.prearm
    const readings = decodeSensors(all, all, healthy)
    expect(readings.filter((r) => r.state === 'unhealthy')).toEqual([])
  })
})
