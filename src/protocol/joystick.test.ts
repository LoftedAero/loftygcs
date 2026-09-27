import { describe, expect, it } from 'vitest'
import {
  axisToPwm,
  channelsFor,
  conflictingChannels,
  DEFAULT_CONFIG,
  ignoreValue,
  initialButtonState,
  OVERRIDE_FIELDS,
  primeButtons,
  PWM_MAX,
  PWM_MID,
  PWM_MIN,
  RELEASE,
  releaseValue,
  sanitizeConfig,
  stepButtons,
  sticksAreSafe,
  type AxisMap,
  type ButtonMap,
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

describe('the special values', () => {
  // Measured against SITL: below channel 9, 65535 is "no change" and 0 hands
  // the channel back; from 9 up, 0 is "no change" and 65534 hands it back.
  it('differ either side of channel 8', () => {
    expect(ignoreValue(1)).toBe(65535)
    expect(ignoreValue(8)).toBe(65535)
    expect(ignoreValue(9)).toBe(0)
    expect(ignoreValue(16)).toBe(0)
    expect(releaseValue(1)).toBe(0)
    expect(releaseValue(8)).toBe(0)
    expect(releaseValue(9)).toBe(65534)
    expect(releaseValue(16)).toBe(65534)
  })

  it('release every mappable channel, not only the first eight', () => {
    // A release of zeros leaves 9-16 held wherever the gamepad left them.
    expect(RELEASE).toHaveLength(OVERRIDE_FIELDS)
    for (let ch = 1; ch <= 8; ch++) expect(RELEASE[ch - 1]).toBe(0)
    for (let ch = 9; ch <= 16; ch++) expect(RELEASE[ch - 1]).toBe(65534)
    // 17 and 18 do not exist on ArduPilot and are left alone.
    expect(RELEASE[16]).toBe(0)
    expect(RELEASE[17]).toBe(0)
  })
})

describe('the whole message', () => {
  it('leaves unmapped channels alone rather than centering them', () => {
    // Sending 1500 on an unmapped channel would drive a flight-mode switch
    // to its middle position -- a mode change nobody asked for.
    const out = channelsFor(pad([0, 0, 0, 0]), DEFAULT_CONFIG)
    expect(out).toHaveLength(OVERRIDE_FIELDS)
    expect(out[4]).toBe(65535)
    expect(out[7]).toBe(65535)
    // Above channel 8 "no change" is zero, and 65534 would be a release.
    expect(out[8]).toBe(0)
    expect(out[15]).toBe(0)
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

  it('drives a channel above 8 from a slider', () => {
    const config: JoystickConfig = {
      ...DEFAULT_CONFIG,
      axes: [{ channel: 12, axis: 4, reverse: false, centered: false, expo: 0 }],
    }
    expect(channelsFor(pad([0, 0, 0, 0, 1]), config)[11]).toBe(PWM_MAX)
    expect(channelsFor(pad([0, 0, 0, 0, 0]), config)[11]).toBe(PWM_MID)
  })

  it('never drives a channel ArduPilot does not have', () => {
    const config: JoystickConfig = {
      ...DEFAULT_CONFIG,
      axes: [{ channel: 17, axis: 0, reverse: false, centered: false, expo: 0 }],
    }
    expect(channelsFor(pad([1]), config)[16]).toBe(ignoreValue(17))
  })
})

describe('buttons', () => {
  const button = (mode: ButtonMap['mode'], values: number[]): JoystickConfig => ({
    ...DEFAULT_CONFIG,
    buttons: [{ channel: 7, button: 0, mode, values }],
  })
  /** One read per entry, returning what channel 7 sends after each. */
  const run = (config: JoystickConfig, reads: boolean[], rc: number[] = []) => {
    let state = initialButtonState(config, rc)
    return reads.map((down) => {
      const p = pad([0, 1, 0, 0], [down])
      state = stepButtons(config, p, state).state
      return channelsFor(p, config, state)[6]
    })
  }

  it('sends the second value only while a momentary is held', () => {
    expect(run(button('momentary', [1100, 1900]), [false, true, true, false])).toEqual([
      1100, 1900, 1900, 1100,
    ])
  })

  it('flips a toggle on each press, not on each read it is held', () => {
    const reads = [true, true, true, false, true, false]
    expect(run(button('toggle', [1100, 1900]), reads)).toEqual([1900, 1900, 1900, 1900, 1100, 1100])
  })

  it('starts a toggle where the vehicle already has it', () => {
    // Otherwise taking control moves every mapped switch to its first
    // position.
    const config = button('toggle', [1100, 1900])
    const rc = [1500, 1500, 1000, 1500, 1500, 1500, 1880]
    expect(run(config, [false], rc)).toEqual([1900])
    expect(run(config, [false, true], rc)).toEqual([1900, 1100])
  })

  it('starts a momentary released whatever the vehicle reads', () => {
    const rc = [0, 0, 0, 0, 0, 0, 1900]
    expect(run(button('momentary', [1100, 1900]), [false], rc)).toEqual([1100])
  })

  it('starts on the first position when the channel reading is unknown', () => {
    const config = button('toggle', [1100, 1900])
    expect(initialButtonState(config, []).position).toEqual([0])
    expect(initialButtonState(config, [0, 0, 0, 0, 0, 0, 0]).position).toEqual([0])
  })

  it('does not flip a switch that was held when control was taken', () => {
    // Priming by stepping did exactly this: the held button read as a press.
    const config = button('toggle', [1100, 1900])
    const held = pad([0, 1, 0, 0], [true])
    const primed = primeButtons(config, held, initialButtonState(config))
    expect(primed.position).toEqual([0])
    const next = stepButtons(config, held, primed).state
    expect(channelsFor(held, config, next)[6]).toBe(1100)
    // Let go and press again: that one counts.
    const up = stepButtons(config, pad([0, 1, 0, 0], [false]), next).state
    expect(stepButtons(config, held, up).state.position).toEqual([1])
  })

  it('flags a channel two mappings drive', () => {
    const config: JoystickConfig = {
      ...DEFAULT_CONFIG,
      buttons: [
        { channel: 3, button: 0, mode: 'momentary', values: [1000, 2000] },
        { channel: 8, button: 1, mode: 'toggle', values: [1000, 2000] },
        // Unassigned, so it drives nothing and cannot conflict.
        { channel: 1, button: -1, mode: 'toggle', values: [1000, 2000] },
      ],
    }
    expect(conflictingChannels(config)).toEqual([3])
  })
})

describe('set buttons: several buttons, one switch', () => {
  // Three buttons on the flight-mode channel, one per position.
  const modes: JoystickConfig = {
    ...DEFAULT_CONFIG,
    buttons: [
      { channel: 5, button: 0, mode: 'set', values: [1165] },
      { channel: 5, button: 1, mode: 'set', values: [1425] },
      { channel: 5, button: 2, mode: 'set', values: [1815] },
    ],
  }
  /** Channel 5 after each read, the pad holding the given buttons down. */
  const run = (reads: number[][], rc: number[] = []) => {
    let state = initialButtonState(modes, rc)
    return reads.map((held) => {
      const p = pad(
        [0, 1, 0, 0],
        [0, 1, 2].map((b) => held.includes(b)),
      )
      state = stepButtons(modes, p, state).state
      return channelsFor(p, modes, state)[4]
    })
  }

  it('leaves the channel alone until one of them is pressed', () => {
    // Taking control must not change the flight mode.
    expect(run([[], []], [0, 0, 0, 0, 1425])).toEqual([65535, 65535])
  })

  it('holds the last one pressed, after it is let go', () => {
    expect(run([[2], [], [], [0], [], [1], []])).toEqual([1815, 1815, 1815, 1165, 1165, 1425, 1425])
  })

  it('is not a conflict, however many share the channel', () => {
    expect(conflictingChannels(modes)).toEqual([])
  })

  it('still conflicts with a stick or a toggle on the same channel', () => {
    const clash: JoystickConfig = {
      ...modes,
      buttons: [...modes.buttons, { channel: 5, button: 3, mode: 'toggle', values: [1000, 2000] }],
    }
    expect(conflictingChannels(clash)).toEqual([5])
  })
})

describe('flight mode buttons', () => {
  const config: JoystickConfig = {
    ...DEFAULT_CONFIG,
    buttons: [
      { channel: 5, button: 0, mode: 'mode', values: [], flightMode: 'RTL' },
      { channel: 6, button: 1, mode: 'mode', values: [], flightMode: '' },
    ],
  }

  it('asks for the mode on the press, once', () => {
    let state = initialButtonState(config)
    const asked = [[true], [true], [false], [true]].map(([down]) => {
      const step = stepButtons(config, pad([0, 1, 0, 0], [down!, false]), state)
      state = step.state
      return step.modePressed
    })
    expect(asked).toEqual(['RTL', null, null, 'RTL'])
  })

  it('asks for nothing when no mode was chosen', () => {
    const state = initialButtonState(config)
    expect(stepButtons(config, pad([0, 1, 0, 0], [false, true]), state).modePressed).toBeNull()
  })

  it('drives no channel, even the one it happens to carry', () => {
    const p = pad([0, 1, 0, 0], [true, true])
    const state = stepButtons(config, p, initialButtonState(config)).state
    const out = channelsFor(p, config, state)
    expect(out[4]).toBe(65535)
    expect(out[5]).toBe(65535)
    expect(
      conflictingChannels({
        ...config,
        axes: [...config.axes, { channel: 5, axis: 4, reverse: false, centered: false, expo: 0 }],
      }),
    ).toEqual([])
  })
})

describe('before taking control', () => {
  it('takes the throttle wherever it is', () => {
    // Control taken over from a transmitter in flight is taken at hover
    // throttle; demanding it be down could only be met by cutting the motors.
    expect(sticksAreSafe(pad([0, -1, 0, 0]), DEFAULT_CONFIG)).toBe(true)
    expect(sticksAreSafe(pad([0, 0, 0, 0]), DEFAULT_CONFIG)).toBe(true)
  })

  it('refuses a pad whose sticks are off center', () => {
    // The gamepad is usually on a desk with something resting on it.
    expect(sticksAreSafe(pad([0.9, 1, 0, 0]), DEFAULT_CONFIG)).toBe(false)
    expect(sticksAreSafe(pad([0, 1, 0, -0.9]), DEFAULT_CONFIG)).toBe(false)
    expect(sticksAreSafe(pad([0, 0, 0.5, 0]), DEFAULT_CONFIG)).toBe(false)
  })

  it('accepts centered sticks', () => {
    expect(sticksAreSafe(pad([0, 1, 0, 0]), DEFAULT_CONFIG)).toBe(true)
    // A little slop is fine; a pad that reads exactly zero does not exist.
    expect(sticksAreSafe(pad([0.05, 0.95, -0.05, 0.05]), DEFAULT_CONFIG)).toBe(true)
  })

  it('does not check a slider, which rests wherever it was left', () => {
    const slider: AxisMap = { channel: 6, axis: 4, reverse: false, centered: false, expo: 0 }
    const config: JoystickConfig = { ...DEFAULT_CONFIG, axes: [...DEFAULT_CONFIG.axes, slider] }
    expect(sticksAreSafe(pad([0, 1, 0, 0, 0.9]), config)).toBe(true)
  })
})

describe('a config read from storage or a file', () => {
  it("reads an older build's shape", () => {
    const old = {
      axes: [
        { channel: 1, axis: 2, reverse: false, centered: true, expo: 0.3 },
        { channel: 3, axis: 1, reverse: true, centered: false, expo: 0 },
      ],
      buttons: [{ channel: 5, button: 1, pwm: 1900 }],
      deadzone: 0.1,
    }
    const cfg = sanitizeConfig(old)
    expect(cfg.axes.map((a) => a.centered)).toEqual([true, false])
    expect(cfg.buttons).toEqual([
      { channel: 5, button: 1, mode: 'momentary', values: [1000, 1900] },
    ])
    expect(cfg.deadzone).toBe(0.1)
  })

  it('clamps everything into what can be sent', () => {
    const cfg = sanitizeConfig({
      axes: [{ channel: 40, axis: -9, centered: 'yes', expo: 7 }],
      buttons: [{ channel: 0, button: 3, mode: 'toggle', values: [100, 5000, 1500] }],
      deadzone: 3,
    })
    // Not a boolean, and no older `rest` to read it from: centered, the
    // common case and the one whose check refuses rather than permits.
    expect(cfg.axes[0]).toEqual({ channel: 16, axis: -1, reverse: false, centered: true, expo: 1 })
    expect(cfg.buttons[0]).toEqual({
      channel: 1,
      button: 3,
      mode: 'toggle',
      values: [800, 2200],
    })
    expect(cfg.deadzone).toBe(0.4)
  })

  it('reads the three-way rest an earlier build kept as centered or not', () => {
    // Only `center` sprang back; `low` and `free` differed only in a
    // throttle-down check that no longer exists.
    const cfg = sanitizeConfig({
      axes: [
        { channel: 1, axis: 2, rest: 'center' },
        { channel: 3, axis: 1, rest: 'low' },
        { channel: 6, axis: 4, rest: 'free' },
      ],
    })
    expect(cfg.axes.map((a) => a.centered)).toEqual([true, false, false])
    expect('rest' in cfg.axes[0]!).toBe(false)
  })

  it('drops the release button an earlier build kept', () => {
    // Releasing is the app's; a mapping no longer carries one.
    const cfg = sanitizeConfig({ ...DEFAULT_CONFIG, releaseButton: 8 })
    expect('releaseButton' in cfg).toBe(false)
  })

  it('drops entries it cannot make sense of rather than guessing', () => {
    expect(sanitizeConfig({ axes: [null, 3, 'x'] }).axes).toEqual([])
    expect(sanitizeConfig({ buttons: [null, 7] }).buttons).toEqual([])
  })

  it('gives a toggle exactly two values, a set one, and a mode button none', () => {
    const cfg = sanitizeConfig({
      buttons: [
        { channel: 5, button: 0, mode: 'toggle', values: [1100, 1500, 1900] },
        { channel: 6, button: 1, mode: 'set', values: [1300, 1700] },
        { channel: 7, button: 2, mode: 'mode', values: [1500], flightMode: '  Loiter ' },
      ],
    })
    expect(cfg.buttons[0]!.values).toEqual([1100, 1500])
    expect(cfg.buttons[1]!.values).toEqual([1300])
    expect(cfg.buttons[2]!.values).toEqual([])
    expect(cfg.buttons[2]!.flightMode).toBe('Loiter')
  })

  it('reads a cycle an earlier build saved as a toggle between its first two', () => {
    const cfg = sanitizeConfig({
      buttons: [{ channel: 5, button: 0, mode: 'cycle', values: [1165, 1295, 1425] }],
    })
    expect(cfg.buttons[0]).toEqual({ channel: 5, button: 0, mode: 'toggle', values: [1165, 1295] })
  })

  it('keeps a flight mode name only on a mode button', () => {
    const cfg = sanitizeConfig({
      buttons: [{ channel: 5, button: 0, mode: 'toggle', values: [1000, 2000], flightMode: 'RTL' }],
    })
    expect('flightMode' in cfg.buttons[0]!).toBe(false)
  })

  it('treats a missing axis list as the default and an empty one as a choice', () => {
    expect(sanitizeConfig({}).axes).toEqual(DEFAULT_CONFIG.axes)
    expect(sanitizeConfig({ axes: [] }).axes).toEqual([])
    expect(sanitizeConfig('nonsense')).toEqual(DEFAULT_CONFIG)
  })
})
