import { describe, expect, it } from 'vitest'
import { isServoFunction, servoFunctionAppliesLive } from './servo-function'

describe('servoFunctionAppliesLive', () => {
  it('applies a function given to a free output', () => {
    expect(servoFunctionAppliesLive(0, 28)).toBe(true) // gripper
    expect(servoFunctionAppliesLive(0, 51)).toBe(true) // RCIN1
    expect(servoFunctionAppliesLive(0, 4)).toBe(true) // aileron, scaled on assignment
    expect(servoFunctionAppliesLive(28, 0)).toBe(true)
  })

  it('applies a move between functions scaled alike', () => {
    expect(servoFunctionAppliesLive(4, 19)).toBe(true) // aileron to elevator
    expect(servoFunctionAppliesLive(4, 10)).toBe(true) // to camera trigger, which sets its pulse
  })

  it('owes a restart for motors, throttles and GPIO, either way', () => {
    expect(servoFunctionAppliesLive(0, 33)).toBe(false)
    expect(servoFunctionAppliesLive(33, 34)).toBe(false)
    expect(servoFunctionAppliesLive(36, 0)).toBe(false)
    expect(servoFunctionAppliesLive(0, 70)).toBe(false)
    expect(servoFunctionAppliesLive(0, 179)).toBe(false)
    expect(servoFunctionAppliesLive(0, -1)).toBe(false)
  })

  it('owes a restart where the output would keep another scaling', () => {
    expect(servoFunctionAppliesLive(2, 4)).toBe(false) // flap to aileron
    expect(servoFunctionAppliesLive(184, 4)).toBe(false) // actuator to aileron
    expect(servoFunctionAppliesLive(75, 4)).toBe(false) // a tilt motor's scaling is Plane's own
  })

  it('owes a restart for functions the vehicle scales at boot', () => {
    expect(servoFunctionAppliesLive(0, 26)).toBe(false) // steering
    expect(servoFunctionAppliesLive(0, 88)).toBe(false) // winch
  })

  it('assumes a restart for a function newer than the table', () => {
    expect(servoFunctionAppliesLive(0, 190)).toBe(false)
  })

  it('names the parameter', () => {
    expect(isServoFunction('SERVO9_FUNCTION')).toBe(true)
    expect(isServoFunction('SERVO16_FUNCTION')).toBe(true)
    expect(isServoFunction('SERVO_GPIO_MASK')).toBe(false)
    expect(isServoFunction('SERVO9_MIN')).toBe(false)
  })
})
