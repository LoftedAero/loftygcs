// Turning a gamepad into RC channels.
//
// This is the one feature here that can fly the aircraft, so the shape of
// it is chosen for what happens when something goes wrong rather than for
// what happens when everything works.
//
// The unit is the same one a transmitter sends: a channel is microseconds,
// 1000 to 2000, centered at 1500. ArduPilot reads RC_CHANNELS_OVERRIDE
// exactly as it reads a receiver, which is what makes this useful and also
// what makes it dangerous: there is no separate "simulated" path, and a
// stuck override is a stuck stick.
//
// Two values in that message are not microseconds and both matter:
//
//   0      release this channel back to the real receiver
//   65535  leave this channel as it was ("no change")
//
// So stopping is not "stop sending" -- a vehicle whose override simply goes
// quiet holds the last value until its RC failsafe notices. Stopping is
// sending zeros, which is what `RELEASE` is for.
//
// Pure: no Gamepad API, no timers, no sending. The service above it owns
// all of that, and this owns the arithmetic that decides where the sticks
// are.

/** Microseconds, the range every transmitter and every autopilot agrees on. */
export const PWM_MIN = 1000
export const PWM_MID = 1500
export const PWM_MAX = 2000

/** How many channels an override message carries in its first block. */
export const CHANNELS = 8

/** Hand the channels back to the receiver. Not the same as sending nothing. */
export const RELEASE: number[] = new Array<number>(CHANNELS).fill(0)

export interface AxisMap {
  /** RC channel, 1-based, as ArduPilot numbers them. */
  channel: number
  /** Index into the gamepad's axis list, or -1 for unassigned. */
  axis: number
  reverse: boolean
  /**
   * Whether the axis rests at the middle.
   *
   * A throttle does not: it rests at one end, and a center deadzone on it
   * would put a dead patch in the middle of the useful travel.
   */
  centered: boolean
  /**
   * Softening around center, 0 to 1. Cubic, the same curve transmitters
   * call expo -- fine control where the stick is nearly still, full
   * authority at the stops.
   */
  expo: number
}

export interface ButtonMap {
  channel: number
  /** Index into the gamepad's button list. */
  button: number
  /** What the channel reads while the button is held. */
  pwm: number
}

export interface JoystickConfig {
  axes: AxisMap[]
  buttons: ButtonMap[]
  /** Fraction of travel around center that reads as center, 0 to 0.5. */
  deadzone: number
}

/**
 * A Mode 2 transmitter, as nearly as a gamepad can be one.
 *
 * Left stick is throttle and yaw, right stick is pitch and roll, which is
 * what almost every pilot in the world has in their hands. The Gamepad API
 * reports Y axes as -1 up, so throttle is reversed (stick up is more) and
 * pitch is not (stick forward is nose down, the same as a real elevator).
 */
export const DEFAULT_CONFIG: JoystickConfig = {
  axes: [
    { channel: 1, axis: 2, reverse: false, centered: true, expo: 0.3 },
    { channel: 2, axis: 3, reverse: false, centered: true, expo: 0.3 },
    { channel: 3, axis: 1, reverse: true, centered: false, expo: 0 },
    { channel: 4, axis: 0, reverse: false, centered: true, expo: 0.3 },
  ],
  buttons: [],
  deadzone: 0.08,
}

export const CHANNEL_NAMES: Record<number, string> = {
  1: 'Roll',
  2: 'Pitch',
  3: 'Throttle',
  4: 'Yaw',
}

/** Applies the deadzone and rescales, so the travel outside it stays full. */
function deaden(v: number, deadzone: number): number {
  const size = Math.abs(v)
  if (size <= deadzone) return 0
  // Without the rescale the stick jumps from zero to the deadzone's worth
  // of authority the moment it leaves the dead patch.
  const scaled = (size - deadzone) / (1 - deadzone)
  return Math.sign(v) * scaled
}

function applyExpo(v: number, expo: number): number {
  const e = Math.min(1, Math.max(0, expo))
  return (1 - e) * v + e * v * v * v
}

/**
 * One axis, from the gamepad's -1..1 to microseconds.
 *
 * Clamped at both ends rather than trusted: a worn stick reads past 1.0 on
 * some pads, and a channel above 2000 is a value ArduPilot will read as a
 * failsafe rather than as full deflection.
 */
export function axisToPwm(raw: number, map: AxisMap, deadzone: number): number {
  if (!Number.isFinite(raw)) return PWM_MID
  const signed = map.reverse ? -raw : raw
  const shaped = map.centered
    ? applyExpo(deaden(signed, deadzone), map.expo)
    : // An end-resting axis gets neither: there is no center to be soft
      // around, and a deadzone there is a dead patch mid-travel.
      Math.min(1, Math.max(-1, signed))
  const pwm = Math.round(PWM_MID + shaped * (PWM_MAX - PWM_MID))
  return Math.min(PWM_MAX, Math.max(PWM_MIN, pwm))
}

export interface PadState {
  axes: readonly number[]
  buttons: readonly boolean[]
}

/**
 * The whole override message's worth of channels.
 *
 * Channels nothing is mapped to are sent as 65535 -- "no change" -- rather
 * than as a center value. Sending 1500 on an unmapped channel would
 * override a flight-mode switch to its middle position, which on a real
 * aircraft is a mode change nobody asked for.
 */
export function channelsFor(pad: PadState, config: JoystickConfig): number[] {
  const NO_CHANGE = 65535
  const out = new Array<number>(CHANNELS).fill(NO_CHANGE)
  for (const map of config.axes) {
    if (map.axis < 0 || map.channel < 1 || map.channel > CHANNELS) continue
    const raw = pad.axes[map.axis]
    if (raw === undefined) continue
    out[map.channel - 1] = axisToPwm(raw, map, config.deadzone)
  }
  for (const map of config.buttons) {
    if (map.channel < 1 || map.channel > CHANNELS) continue
    if (pad.buttons[map.button]) out[map.channel - 1] = map.pwm
  }
  return out
}

/**
 * Whether a pad's sticks are anywhere near their rest positions.
 *
 * Checked before an override is allowed to start: taking control with the
 * throttle already at the top is the way this feature hurts someone, and
 * the gamepad is usually on a desk with something resting on it.
 */
export function sticksAreSafe(pad: PadState, config: JoystickConfig): boolean {
  for (const map of config.axes) {
    const raw = pad.axes[map.axis]
    if (raw === undefined) continue
    const value = map.reverse ? -raw : raw
    // A centered axis must be near the middle; a throttle must be at its
    // low end, which after the reverse is -1.
    if (map.centered ? Math.abs(value) > 0.2 : value > -0.8) return false
  }
  return true
}
