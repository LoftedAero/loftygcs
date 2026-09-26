import { describe, expect, it } from 'vitest'
import { countBits, describeBits } from './BitmaskEditor'

const AXES = { 0: 'Roll', 1: 'Pitch', 2: 'Yaw' }
const LONG = { 0: 'Gyro', 1: 'Accelerometer', 2: 'Barometer', 3: 'Magnetometer' }

describe('describeBits', () => {
  it('lists every bit when the list is no longer than the shortened form', () => {
    expect(describeBits(7, AXES, 2)).toBe('Roll, Pitch, Yaw')
  })

  it('shortens a list that the count would make shorter', () => {
    expect(describeBits(15, LONG, 2)).toBe('Gyro, Accelerometer, +2 more')
  })
})

describe('countBits', () => {
  it('counts what is set, and says none for zero', () => {
    expect(countBits(0)).toBe('none')
    expect(countBits(1)).toBe('1 selected')
    expect(countBits(0b1011)).toBe('3 selected')
  })

  it('shows one short name as itself, and counts a long one', () => {
    expect(countBits(1, { 0: 'All', 1: 'PPM' })).toBe('All')
    expect(countBits(0b100000, { 5: 'Arming check throttle for 0 input' })).toBe('1 selected')
    expect(countBits(3, { 0: 'All', 1: 'PPM' })).toBe('2 selected')
  })
})
