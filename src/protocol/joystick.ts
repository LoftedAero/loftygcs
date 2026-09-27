// Turning a gamepad into RC channels.
//
// Channels are microseconds, 1000 to 2000, centered at 1500. ArduPilot reads
// RC_CHANNELS_OVERRIDE exactly as it reads a receiver, so a stuck override is
// a stuck stick.
//
// The two special values differ by channel (MAVLink spec, confirmed on SITL):
//
//               ignore ("no change")   release to the receiver
//   ch 1-8      65535                  0
//   ch 9-18     0 or 65535             65534
//
// A release of all zeros hands back 1-8 and leaves 9-16 held, so every frame
// is built per channel from `ignoreValue` and `releaseValue`.
//
// Stopping means sending the release, not going quiet: a vehicle whose
// override stream stops holds the last value until RC_OVERRIDE_TIME runs out.
//
// Pure: no Gamepad API, timers or sending; the service above owns those.

/** Microseconds. */
export const PWM_MIN = 1000
export const PWM_MID = 1500
export const PWM_MAX = 2000
/** What a button may be told to send: a little past the usual travel, no more. */
export const PWM_LIMIT_MIN = 800
export const PWM_LIMIT_MAX = 2200

/** RC channels ArduPilot has (NUM_RC_CHANNELS), and so the ones mappable here. */
export const CHANNELS = 16
/** Channel fields the override message carries; 17 and 18 are always ignored. */
export const OVERRIDE_FIELDS = 18

/** "Leave this channel as it is", which is a different number above channel 8. */
export function ignoreValue(channel: number): number {
  return channel <= 8 ? 65535 : 0
}

/** "Hand this channel back to the receiver", likewise. */
export function releaseValue(channel: number): number {
  return channel <= 8 ? 0 : 65534
}

/** A frame that hands every mappable channel back to the receiver. */
export const RELEASE: readonly number[] = Array.from({ length: OVERRIDE_FIELDS }, (_, i) =>
  i < CHANNELS ? releaseValue(i + 1) : ignoreValue(i + 1),
)

export interface AxisMap {
  /** RC channel, 1-based, as ArduPilot numbers them. */
  channel: number
  /** Index into the gamepad's axis list, or -1 for unassigned. */
  axis: number
  reverse: boolean
  /**
   * Whether the stick springs back to its middle. A centered axis gets the
   * deadzone and expo and must be near its middle before control is taken;
   * one that stays where it is left (a throttle, slider or dial) gets neither
   * and is not checked.
   */
  centered: boolean
  /**
   * Softening around center, 0 to 1: the cubic curve transmitters call expo.
   * Only applies to a centered axis.
   */
  expo: number
}

/**
 * What a button does.
 *
 * `momentary` sends its second value while held and its first otherwise;
 * `toggle` flips between its two on each press. `set` sends its one value
 * from the press on, until another `set` button on the same channel is
 * pressed (three on the mode channel make a three-position switch). `mode`
 * drives no channel: it asks the vehicle for a flight mode by name.
 */
export type ButtonMode = 'momentary' | 'toggle' | 'set' | 'mode'

export interface ButtonMap {
  /** RC channel, 1-based; not used by a `mode` button. */
  channel: number
  /** Index into the gamepad's button list, or -1 for unassigned. */
  button: number
  mode: ButtonMode
  /** Microseconds: two for momentary and toggle, one for set, none for mode. */
  values: number[]
  /**
   * The flight mode a `mode` button asks for, by ArduPilot's name ("Loiter",
   * "RTL"). Mode numbers differ per vehicle (RTL is 6 on Copter, 11 on Plane).
   */
  flightMode?: string
}

export interface JoystickConfig {
  axes: AxisMap[]
  buttons: ButtonMap[]
  /** Fraction of travel around center that reads as center, 0 to 0.4. */
  deadzone: number
}

/**
 * A Mode 2 transmitter, as nearly as a gamepad can be one.
 *
 * Left stick is throttle and yaw, right stick pitch and roll. The Gamepad API
 * reports Y axes as -1 up, so throttle is reversed (stick up is more) and
 * pitch is not (stick forward is nose down).
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

export function channelName(channel: number): string {
  return CHANNEL_NAMES[channel] ?? `Ch ${channel}`
}

/** The values a new button mapping starts with, by mode. */
export function defaultValues(mode: ButtonMode): number[] {
  if (mode === 'set') return [PWM_MID]
  if (mode === 'mode') return []
  return [PWM_MIN, PWM_MAX]
}

/** Applies the deadzone and rescales, so the travel outside it stays full. */
function deaden(v: number, deadzone: number): number {
  const size = Math.abs(v)
  if (size <= deadzone) return 0
  // Rescale so output does not jump when the stick leaves the deadzone.
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
 * Clamped: a worn stick can read past 1.0, and ArduPilot may read a channel
 * above 2000 as a failsafe rather than full deflection.
 */
export function axisToPwm(raw: number, map: AxisMap, deadzone: number): number {
  if (!Number.isFinite(raw)) return PWM_MID
  const signed = map.reverse ? -raw : raw
  const shaped = map.centered
    ? applyExpo(deaden(signed, deadzone), map.expo)
    : // No deadzone or expo: on a non-centered axis a deadzone is a dead
      // patch mid-travel.
      Math.min(1, Math.max(-1, signed))
  const pwm = Math.round(PWM_MID + shaped * (PWM_MAX - PWM_MID))
  return Math.min(PWM_MAX, Math.max(PWM_MIN, pwm))
}

export interface PadState {
  axes: readonly number[]
  buttons: readonly boolean[]
}

/**
 * Per-button state carried between reads: whether it was down last read
 * (a toggle acts on the press edge) and which of its values it is on.
 */
export interface ButtonState {
  down: boolean[]
  position: number[]
  /**
   * The value the last `set` button pressed on each channel sent, indexed by
   * channel - 1; null until one is pressed. Per channel because the buttons
   * sharing a channel act as one switch.
   */
  latched: (number | null)[]
}

const noLatches = (): (number | null)[] => Array.from({ length: CHANNELS }, () => null)

/**
 * A starting state that matches the vehicle, where it is known.
 *
 * Each toggle starts on whichever of its values is nearest to what that
 * channel reads now, and a `set` channel is left alone until one of its
 * buttons is pressed, so taking control does not move any switch.
 */
export function initialButtonState(
  config: JoystickConfig,
  current: readonly (number | undefined)[] = [],
): ButtonState {
  return {
    down: config.buttons.map(() => false),
    position: config.buttons.map((b) => {
      const now = current[b.channel - 1]
      if (b.mode !== 'toggle' || now === undefined || now <= 0) return 0
      let best = 0
      b.values.forEach((v, i) => {
        if (Math.abs(v - now) < Math.abs((b.values[best] ?? v) - now)) best = i
      })
      return best
    }),
    latched: noLatches(),
  }
}

/**
 * Note which buttons are already held, without acting on any of them.
 *
 * Used when control is taken and when the mapping changes, so a button
 * already held does not count as a press on the first read.
 */
export function primeButtons(
  config: JoystickConfig,
  pad: PadState,
  prev: ButtonState,
): ButtonState {
  return {
    down: config.buttons.map((b) => b.button >= 0 && pad.buttons[b.button] === true),
    position: [...prev.position],
    latched: [...prev.latched],
  }
}

/**
 * Advance the buttons by one read. Returns the new state and the flight mode
 * a `mode` button asked for on this read.
 */
export function stepButtons(
  config: JoystickConfig,
  pad: PadState,
  prev: ButtonState,
): { state: ButtonState; modePressed: string | null } {
  const down: boolean[] = []
  const position: number[] = []
  const latched = prev.latched.length === CHANNELS ? [...prev.latched] : noLatches()
  let modePressed: string | null = null
  config.buttons.forEach((b, i) => {
    const now = b.button >= 0 && pad.buttons[b.button] === true
    const was = prev.down[i] ?? false
    let pos = prev.position[i] ?? 0
    // On the press, not while held: a held button is one press.
    if (now && !was) {
      if (b.mode === 'toggle') pos = pos === 0 ? 1 : 0
      if (b.mode === 'set' && b.values[0] !== undefined) latched[b.channel - 1] = b.values[0]
      if (b.mode === 'mode' && b.flightMode) modePressed = b.flightMode
    }
    down.push(now)
    position.push(pos)
  })
  return { state: { down, position, latched }, modePressed }
}

/**
 * The whole override message's worth of channel fields.
 *
 * Unmapped channels are sent as "no change", never 1500, which would drive a
 * flight-mode switch to its middle position. Where two mappings drive one
 * channel the later one wins; the setup screen flags that as a conflict.
 */
export function channelsFor(
  pad: PadState,
  config: JoystickConfig,
  buttons: ButtonState = initialButtonState(config),
): number[] {
  const out = Array.from({ length: OVERRIDE_FIELDS }, (_, i) => ignoreValue(i + 1))
  for (const map of config.axes) {
    if (map.axis < 0 || map.channel < 1 || map.channel > CHANNELS) continue
    const raw = pad.axes[map.axis]
    if (raw === undefined) continue
    out[map.channel - 1] = axisToPwm(raw, map, config.deadzone)
  }
  config.buttons.forEach((map, i) => {
    if (map.button < 0 || map.mode === 'mode' || map.channel < 1 || map.channel > CHANNELS) return
    const value =
      map.mode === 'momentary'
        ? map.values[buttons.down[i] ? 1 : 0]
        : map.mode === 'set'
          ? (buttons.latched[map.channel - 1] ?? undefined)
          : map.values[buttons.position[i] ?? 0]
    if (value !== undefined) out[map.channel - 1] = value
  })
  return out
}

/**
 * Channels more than one mapping drives, for the setup screen to flag. The
 * `set` buttons on a channel are one switch between them, not a conflict; a
 * `mode` button drives no channel.
 */
export function conflictingChannels(config: JoystickConfig): number[] {
  const seen = new Map<number, number>()
  const add = (ch: number) => seen.set(ch, (seen.get(ch) ?? 0) + 1)
  for (const a of config.axes) if (a.axis >= 0) add(a.channel)
  const setChannels = new Set<number>()
  for (const b of config.buttons) {
    if (b.button < 0 || b.mode === 'mode') continue
    if (b.mode === 'set') setChannels.add(b.channel)
    else add(b.channel)
  }
  for (const ch of setChannels) add(ch)
  return [...seen].filter(([, n]) => n > 1).map(([ch]) => ch)
}

/**
 * Whether a pad's spring-centered sticks are near the middle.
 *
 * Checked before an override starts, since the gamepad may be on a desk with
 * something resting on it. A non-centered throttle is not checked: control
 * taken over in flight is taken at hover throttle, and requiring it down
 * would mean cutting the motors.
 */
export function sticksAreSafe(pad: PadState, config: JoystickConfig): boolean {
  for (const map of config.axes) {
    if (map.axis < 0 || !map.centered) continue
    const raw = pad.axes[map.axis]
    if (raw === undefined) continue
    if (Math.abs(raw) > 0.2) return false
  }
  return true
}

const int = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/**
 * Any stored or imported config, made into one this code can trust.
 *
 * Input comes from storage an older build wrote or from an imported file, so
 * channels and values are clamped, modes checked, and unreadable maps
 * dropped. A legacy `rest` field maps to `centered` (only `center` was
 * centered); a legacy `releaseButton` is dropped.
 */
export function sanitizeConfig(input: unknown): JoystickConfig {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const axesIn = Array.isArray(src.axes) ? src.axes : null
  const axes: AxisMap[] = (axesIn ?? DEFAULT_CONFIG.axes).flatMap((a: unknown) => {
    if (!a || typeof a !== 'object') return []
    const m = a as Record<string, unknown>
    const centered =
      typeof m.centered === 'boolean'
        ? m.centered
        : typeof m.rest === 'string'
          ? m.rest === 'center'
          : true
    return [
      {
        channel: int(m.channel, 1, CHANNELS, 1),
        axis: int(m.axis, -1, 63, -1),
        reverse: m.reverse === true,
        centered,
        expo: num(m.expo, 0, 1, 0),
      },
    ]
  })
  const buttonsIn = Array.isArray(src.buttons) ? src.buttons : []
  const buttons: ButtonMap[] = buttonsIn.flatMap((b: unknown) => {
    if (!b || typeof b !== 'object') return []
    const m = b as Record<string, unknown>
    // Legacy shapes: `cycle` becomes a toggle between its first two values,
    // and a single held `pwm` becomes a momentary from low to that value.
    const mode: ButtonMode =
      m.mode === 'toggle' || m.mode === 'momentary' || m.mode === 'set' || m.mode === 'mode'
        ? m.mode
        : m.mode === 'cycle'
          ? 'toggle'
          : 'momentary'
    let values = Array.isArray(m.values)
      ? m.values.map((v) => int(v, PWM_LIMIT_MIN, PWM_LIMIT_MAX, PWM_MID))
      : typeof m.pwm === 'number'
        ? [PWM_MIN, int(m.pwm, PWM_LIMIT_MIN, PWM_LIMIT_MAX, PWM_MAX)]
        : defaultValues(mode)
    if (mode === 'momentary' || mode === 'toggle') {
      values = [values[0] ?? PWM_MIN, values[1] ?? PWM_MAX]
    }
    if (mode === 'set') values = [values[0] ?? PWM_MID]
    if (mode === 'mode') values = []
    const map: ButtonMap = {
      channel: int(m.channel, 1, CHANNELS, 5),
      button: int(m.button, -1, 127, -1),
      mode,
      values,
    }
    // Resolved against the vehicle only when pressed.
    if (mode === 'mode') {
      map.flightMode = typeof m.flightMode === 'string' ? m.flightMode.trim().slice(0, 32) : ''
    }
    return [map]
  })
  return {
    // A missing axes list gets the defaults; an empty one stays empty.
    axes,
    buttons,
    deadzone: num(src.deadzone, 0, 0.4, DEFAULT_CONFIG.deadzone),
  }
}
