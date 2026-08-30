import { describe, expect, it } from 'vitest'
import { modeSlotForPwm } from './FlightModesTab'

// The PWM bands ArduPilot uses to pick one of six mode slots. Getting a
// boundary wrong would highlight the wrong row while the vehicle flies
// another mode -- exactly the confusion this display exists to prevent.
describe('modeSlotForPwm', () => {
  it('maps each band to its slot', () => {
    expect(modeSlotForPwm(1000)).toBe(1)
    expect(modeSlotForPwm(1230)).toBe(1)
    expect(modeSlotForPwm(1231)).toBe(2)
    expect(modeSlotForPwm(1360)).toBe(2)
    expect(modeSlotForPwm(1361)).toBe(3)
    expect(modeSlotForPwm(1490)).toBe(3)
    expect(modeSlotForPwm(1491)).toBe(4)
    expect(modeSlotForPwm(1620)).toBe(4)
    expect(modeSlotForPwm(1621)).toBe(5)
    expect(modeSlotForPwm(1749)).toBe(5)
    expect(modeSlotForPwm(1750)).toBe(6)
    expect(modeSlotForPwm(2000)).toBe(6)
  })

  it('reports no slot when the channel is silent', () => {
    expect(modeSlotForPwm(0)).toBe(0)
    expect(modeSlotForPwm(500)).toBe(0)
  })
})
