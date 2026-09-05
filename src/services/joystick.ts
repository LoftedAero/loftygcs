import { connectionService } from './connection'
import { useConnectionStore } from '../stores/connection-store'
import { useJoystickStore } from '../stores/joystick-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { CHANNELS, RELEASE, channelsFor, sticksAreSafe, type PadState } from '../protocol/joystick'

// Flying with a gamepad.
//
// RC_CHANNELS_OVERRIDE is read by ArduPilot exactly as it reads a receiver,
// which is what makes this useful and what makes every decision here a
// safety decision. The rules, in the order they matter:
//
//  1. It is off at every start. Nothing persists it.
//  2. It refuses to start unless the sticks are at rest and the throttle is
//     down -- the pad is usually on a desk with something on it.
//  3. It stops itself when the window loses focus, when the tab is hidden,
//     when the pad is unplugged, and when the link drops.
//  4. Stopping means *sending zeros*, not going quiet. A vehicle whose
//     override stream stops holds the last value until its own RC failsafe
//     notices, which is seconds of full deflection.
//
// The reading loop runs whenever the panel is open, so the setup screen can
// show what the sticks are doing without anything being sent. Only `active`
// decides whether the channels leave the machine.

/** 20 Hz: what a transmitter feels like, and well inside any override timeout. */
const SEND_INTERVAL_MS = 50
/** How often the pad is read for display; the eye does not resolve more. */
const POLL_INTERVAL_MS = 33
/** Repeats of the release, because a lost packet must not leave it held. */
const RELEASE_REPEATS = 3

let pollTimer: ReturnType<typeof setInterval> | null = null
let sendTimer: ReturnType<typeof setInterval> | null = null
let listening = false

function readPad(): { pad: Gamepad; state: PadState } | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected) continue
    return {
      pad,
      state: { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.pressed) },
    }
  }
  return null
}

/** Start reading the pad for display. Nothing is sent until `enable`. */
export function startReading(): void {
  if (pollTimer) return
  attachGuards()
  pollTimer = setInterval(() => {
    const store = useJoystickStore.getState()
    const found = readPad()
    if (!found) {
      if (store.pad) store.setPad(null)
      if (store.active) stop('The gamepad was unplugged')
      return
    }
    if (store.pad?.index !== found.pad.index) {
      store.setPad({ index: found.pad.index, id: found.pad.id })
    }
    store.setLive(
      found.state.axes as number[],
      found.state.buttons as boolean[],
      channelsFor(found.state, store.config),
    )
  }, POLL_INTERVAL_MS)
}

export function stopReading(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (useJoystickStore.getState().active) stop('The joystick panel was closed')
}

/**
 * Take control.
 *
 * Returns the reason it was refused, or null when it started. Refusing is
 * the common case in normal use and is not an error: a pad on a desk with a
 * book on it fails the stick check every time, which is the point.
 */
export function enable(): string | null {
  const store = useJoystickStore.getState()
  if (useConnectionStore.getState().phase !== 'connected') return 'Not connected to a vehicle'
  const found = readPad()
  if (!found) return 'No gamepad found — press a button on it first'
  if (!sticksAreSafe(found.state, store.config)) {
    return 'Center the sticks and put the throttle down first'
  }
  store.setMessage(null)
  store.setActive(true)
  if (sendTimer) clearInterval(sendTimer)
  sendTimer = setInterval(send, SEND_INTERVAL_MS)
  send()
  return null
}

/** Hand control back, and say why if it was not asked for. */
export function stop(reason?: string): void {
  if (sendTimer) clearInterval(sendTimer)
  sendTimer = null
  const store = useJoystickStore.getState()
  if (!store.active) return
  store.setActive(false)
  if (reason) store.setMessage(reason)
  // Zeros, repeated: this is the message that hands the channels back, and
  // a lost one leaves the vehicle holding the last stick position.
  for (let i = 0; i < RELEASE_REPEATS; i++) {
    setTimeout(() => sendChannels(RELEASE), i * 60)
  }
}

function send(): void {
  const store = useJoystickStore.getState()
  if (useConnectionStore.getState().phase !== 'connected') {
    stop('The link dropped')
    return
  }
  const found = readPad()
  if (!found) {
    stop('The gamepad was unplugged')
    return
  }
  const channels = channelsFor(found.state, store.config)
  store.setLive(found.state.axes as number[], found.state.buttons as boolean[], channels)
  sendChannels(channels)
}

function sendChannels(channels: readonly number[]): void {
  const sysid = useVehicleStore.getState().sysid || 1
  const fields: Record<string, number> = { targetSystem: sysid, targetComponent: 1 }
  for (let i = 0; i < CHANNELS; i++) fields[`chan${i + 1}Raw`] = channels[i] ?? 0
  connectionService.sendMessage('RC_CHANNELS_OVERRIDE', fields)
}

/**
 * The things that must stop it, wired once.
 *
 * A window that loses focus stops receiving gamepad updates in some
 * browsers, so what was a live stick becomes a frozen one -- which is worse
 * than no stick at all.
 */
function attachGuards(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('blur', () => stop('The window lost focus'))
  window.addEventListener('gamepaddisconnected', () => stop('The gamepad was unplugged'))
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('The window was hidden')
  })
}
