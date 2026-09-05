import { describe, expect, it } from 'vitest'
import {
  axisToPwm,
  channelsFor,
  DEFAULT_CONFIG,
  PWM_MAX,
  PWM_MID,
  PWM_MIN,
  RELEASE,
  sticksAreSafe,
  type AxisMap,
  type JoystickConfig,
  type PadState,
} from './joystick'

const centered: AxisMap = { channel: 1, axis: 0, reverse: false, centered: true, expo: 0 }
const throttle: AxisMap = { channel: 3, axis: 1, reverse: true, centered: false, expo: 0 }

const pad = (axes: number[], buttons: boolean[] = []): PadState => ({ axes, buttons })

describe('one axis', () => {
  it('rests in the middle and reaches both stops', () => {
    expect(axisToPwm(0, centered, 0)).toBe(PWM_MID)
    expect(axisToPwm(-1, centered, 0)).toBe(PWM_MIN)
    expect(axisToPwm(1, centered, 0)).toBe(PWM_MAX)
  })

  it('clamps a pad that reads past its stops', () => {
    // Worn sticks do this, and a channel above 2000 reads to ArduPilot as a
    // failsafe rather than as full deflection.
    expect(axisToPwm(1.4, centered, 0)).toBe(PWM_MAX)
    expect(axisToPwm(-1.4, centered, 0)).toBe(PWM_MIN)
  })

  it('answers center for an axis that reads nonsense', () => {
    expect(axisToPwm(NaN, centered, 0)).toBe(PWM_MID)
  })

  it('reverses without moving the center', () => {
    const rev = { ...centered, reverse: true }
    expect(axisToPwm(0, rev, 0)).toBe(PWM_MID)
    expect(axisToPwm(1, rev, 0)).toBe(PWM_MIN)
  })

  describe('the deadzone', () => {
    it('reads as center inside it', () => {
      expect(axisToPwm(0.05, centered, 0.1)).toBe(PWM_MID)
      expect(axisToPwm(-0.05, centered, 0.1)).toBe(PWM_MID)
    })

    it('does not lose the travel outside it', () => {
      // The naive version subtracts the deadzone and leaves the stick short
      // of its stops; this one still reaches them.
      expect(axisToPwm(1, centered, 0.2)).toBe(PWM_MAX)
      expect(axisToPwm(-1, centered, 0.2)).toBe(PWM_MIN)
    })

    it('leaves the edge of the deadzone continuous', () => {
      // A jump here is a stick that snaps to a tenth of full authority the
      // moment it moves.
      const just = axisToPwm(0.101, centered, 0.1)
      expect(Math.abs(just - PWM_MID)).toBeLessThan(5)
    })

    it('is not applied to an axis that rests at one end', () => {
      // A throttle has no center to be dead around, and a deadzone there is
      // a dead patch in the middle of the useful travel.
      expect(axisToPwm(0, throttle, 0.2)).toBe(PWM_MID)
      expect(axisToPwm(-1, throttle, 0.2)).toBe(PWM_MAX)
      expect(axisToPwm(1, throttle, 0.2)).toBe(PWM_MIN)
    })
  })

  describe('expo', () => {
    const soft = { ...centered, expo: 0.5 }

    it('leaves the ends alone', () => {
      expect(axisToPwm(1, soft, 0)).toBe(PWM_MAX)
      expect(axisToPwm(-1, soft, 0)).toBe(PWM_MIN)
      expect(axisToPwm(0, soft, 0)).toBe(PWM_MID)
    })

    it('softens the middle, which is the whole point', () => {
      const linear = axisToPwm(0.5, centered, 0)
      const shaped = axisToPwm(0.5, soft, 0)
      expect(shaped).toBeLessThan(linear)
      expect(shaped).toBeGreaterThan(PWM_MID)
    })

    it('stays monotonic, or the stick would fight the pilot', () => {
      let prev = -Infinity
      for (let v = -1; v <= 1.0001; v += 0.05) {
        const pwm = axisToPwm(v, soft, 0.05)
        expect(pwm).toBeGreaterThanOrEqual(prev)
        prev = pwm
      }
    })
  })
})

describe('the whole message', () => {
  it('leaves unmapped channels alone rather than centering them', () => {
    // 65535 is "no change". Sending 1500 on an unmapped channel would drive
    // a flight-mode switch to its middle position -- a mode change nobody
    // asked for, from a station that was only trying to fly.
    const out = channelsFor(pad([0, 0, 0, 0]), DEFAULT_CONFIG)
    expect(out).toHaveLength(8)
    expect(out[4]).toBe(65535)
    expect(out[7]).toBe(65535)
  })

  it('puts the four sticks on the four channels ArduPilot expects', () => {
    // Right stick full right and full forward, left stick full up.
    const out = channelsFor(pad([0, -1, 1, -1]), DEFAULT_CONFIG)
    expect(out[0]).toBe(PWM_MAX) // roll right
    expect(out[1]).toBe(PWM_MIN) // stick forward is nose down, as on a real elevator
    expect(out[2]).toBe(PWM_MAX) // throttle up, because the pad reports up as -1
    expect(out[3]).toBe(PWM_MID) // yaw centered
  })

  it('ignores an axis the pad does not have', () => {
    const out = channelsFor(pad([0, 0]), DEFAULT_CONFIG)
    // Axes 2 and 3 are missing, so roll and pitch are left unchanged
    // rather than sent as center.
    expect(out[0]).toBe(65535)
    expect(out[1]).toBe(65535)
    expect(out[3]).toBe(PWM_MID)
  })

  it('drives a channel from a held button', () => {
    const config: JoystickConfig = {
      ...DEFAULT_CONFIG,
      buttons: [{ channel: 5, button: 1, pwm: 1900 }],
    }
    expect(channelsFor(pad([0, 0, 0, 0], [false, true]), config)[4]).toBe(1900)
    expect(channelsFor(pad([0, 0, 0, 0], [false, false]), config)[4]).toBe(65535)
  })

  it('releases with zeros, which is not the same as sending nothing', () => {
    // Stopping the stream leaves the vehicle holding the last override
    // until its own RC failsafe notices. Zero hands the channel back.
    expect(RELEASE).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('before taking control', () => {
  it('refuses a pad whose throttle is not down', () => {
    // The gamepad is usually on a desk with something resting on it.
    expect(sticksAreSafe(pad([0, -1, 0, 0]), DEFAULT_CONFIG)).toBe(false)
    expect(sticksAreSafe(pad([0, 0, 0, 0]), DEFAULT_CONFIG)).toBe(false)
  })

  it('refuses a pad whose sticks are off center', () => {
    expect(sticksAreSafe(pad([0.9, 1, 0, 0]), DEFAULT_CONFIG)).toBe(false)
    expect(sticksAreSafe(pad([0, 1, 0, -0.9]), DEFAULT_CONFIG)).toBe(false)
  })

  it('accepts sticks at rest with the throttle at the bottom', () => {
    expect(sticksAreSafe(pad([0, 1, 0, 0]), DEFAULT_CONFIG)).toBe(true)
    // A little slop is fine; a pad that reads exactly zero does not exist.
    expect(sticksAreSafe(pad([0.05, 0.95, -0.05, 0.05]), DEFAULT_CONFIG)).toBe(true)
  })
})
