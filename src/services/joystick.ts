import { connectionService } from './connection'
import { useConnectionStore } from '../stores/connection-store'
import { useJoystickStore } from '../stores/joystick-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { setModeConfirmed } from './flight'
import { modeNumberByName } from '../protocol/modes'
import {
  OVERRIDE_FIELDS,
  RELEASE,
  channelsFor,
  initialButtonState,
  primeButtons,
  sticksAreSafe,
  stepButtons,
  type ButtonState,
  type JoystickConfig,
  type PadState,
} from '../protocol/joystick'

// Flying with a gamepad.
//
// RC_CHANNELS_OVERRIDE is read by ArduPilot exactly as it reads a receiver,
// which is what makes this useful and what makes every decision here a
// safety decision. The rules, in the order they matter:
//
//  1. It is off at every start. Nothing persists it.
//  2. It refuses to start unless the centered sticks are centered -- the pad
//     is usually on a desk with something on it. The throttle is taken
//     wherever it is, so control can be taken over in flight.
//  3. It stops itself when the pad is unplugged or changes, when the link
//     drops, and whenever gamepad input can no longer be trusted to be live
//     (below). Handing control back on purpose is the app's: Release, in the
//     pane and on the app bar from every screen.
//  4. Stopping means *sending the release*, not going quiet, and the release
//     is a different number above channel 8 (protocol/joystick.ts).
//
// **It keeps flying when you look away.** The reading loop runs for the whole
// session, not only while the Joystick pane is open, so switching to the Plan
// screen or another pane does not drop the sticks; the app bar says control
// is taken, with a Release beside it, from every screen. In the desktop app it
// also keeps flying when the window is covered, minimized or not focused:
// taking control turns the window's background throttling off, which is what
// otherwise pauses gamepad input and slows timers when a window is out of
// sight. A browser offers no such switch -- a page out of sight or out of
// focus may get frozen gamepad data -- so there, losing focus or visibility
// still releases, because a stick that has stopped updating is worse than no
// stick. Either way, a page the platform reports hidden releases.

/** 20 Hz: what a transmitter feels like, and well inside any override timeout. */
const SEND_INTERVAL_MS = 50
/** How often the pad is read: fast enough to catch a button's press. */
const POLL_INTERVAL_MS = 33
/** Repeats of the release, because a lost packet must not leave it held. */
const RELEASE_REPEATS = 3

let pollTimer: ReturnType<typeof setInterval> | null = null
let sendTimer: ReturnType<typeof setInterval> | null = null
let listening = false
let buttonState: ButtonState | null = null
/**
 * The mapping `buttonState` was built for. A different one -- a button just
 * learned, a row added -- starts over, primed with what is held: the press
 * that taught a switch is still down on the next read, and stepping it would
 * flip the switch it had only just been assigned to. Never while flying,
 * because the mapping cannot change then.
 */
let buttonsFor: JoystickConfig | null = null
/** The device control was taken on; a different one mid-flight releases. */
let flyingOn: string | null = null

/** The desktop shell, when there is one, can keep an unfocused window live. */
const shell = () => (typeof window !== 'undefined' ? window.loftgcs : undefined)

/** Every device the browser will admit to, in its own index order. */
function connectedPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
  const out: Gamepad[] = []
  // getGamepads() is a sparse array whose holes are meaningful: a pad's
  // index is its slot, so the list is filtered rather than compacted.
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) out.push(pad)
  return out
}

/**
 * The device to read, or null when that is not decided.
 *
 * With one pad attached there is nothing to choose. With several -- a
 * wheel, a HOTAS and a gamepad all sitting on the same desk -- picking the
 * first is picking whichever the browser happened to enumerate first, and
 * on this feature that means the sticks are somewhere other than where the
 * screen says they are. So it stays null until someone says which, and
 * `enable` refuses meanwhile.
 */
function chosenPad(): Gamepad | null {
  const pads = connectedPads()
  if (pads.length === 0) return null
  const wanted = useJoystickStore.getState().deviceId
  if (wanted !== null) return pads.find((p) => p.id === wanted) ?? null
  return pads.length === 1 ? pads[0]! : null
}

function readPad(): { pad: Gamepad; state: PadState } | null {
  const pad = chosenPad()
  if (!pad) return null
  return {
    pad,
    state: { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.pressed) },
  }
}

/**
 * One read of the pad: the live picture, the buttons' presses, and the
 * checks that can end a flight. Shared by the poll and the send so that
 * whichever runs, it sees the same pad the same way.
 */
function tick(): { channels: number[] } | null {
  const store = useJoystickStore.getState()
  const pads = connectedPads().map((p) => ({ index: p.index, id: p.id }))
  const found = readPad()
  store.setPads(pads, found ? { index: found.pad.index, id: found.pad.id } : null)
  if (!found) {
    // Losing the chosen device is the unplug case whether the cable came out
    // or the browser dropped it.
    if (store.active) stop('The gamepad was unplugged')
    return null
  }
  if (store.active && flyingOn !== null && found.pad.id !== flyingOn) {
    stop('The gamepad changed')
    return null
  }
  const config = useJoystickStore.getState().config
  if (!buttonState || buttonsFor !== config) {
    buttonState = primeButtons(config, found.state, initialButtonState(config))
    buttonsFor = config
  }
  const stepped = stepButtons(config, found.state, buttonState)
  buttonState = stepped.state
  // Only while the gamepad has control: a mode button is part of flying it,
  // and a pad on a desk that is only being watched must not change modes.
  if (stepped.modePressed && store.active) requestMode(stepped.modePressed)
  const channels = channelsFor(found.state, config, buttonState)
  store.setLive(found.state.axes as number[], found.state.buttons as boolean[], channels)
  return { channels }
}

/**
 * Start reading. Called once, when the app starts, and harmless to repeat.
 * Reading is not sending: nothing leaves the machine until `enable`.
 */
export function startReading(): void {
  if (pollTimer) return
  attachGuards()
  pollTimer = setInterval(tick, POLL_INTERVAL_MS)
}

/** Stop reading, releasing first if control is taken. For tests and teardown. */
export function stopReading(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (useJoystickStore.getState().active) stop('Joystick reading stopped')
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
  if (!found) {
    return connectedPads().length > 1
      ? 'Several devices are attached — choose which one to fly with'
      : 'No gamepad found — press a button on it first'
  }
  if (!sticksAreSafe(found.state, store.config)) {
    return 'Center the sticks first'
  }
  // Switches start where the vehicle's channels are, so taking control does
  // not move every one of them to its first position (initialButtonState).
  const rc = useVehicleStore.getState().rcChannels
  buttonState = initialButtonState(store.config, rc)
  // A switch that was down before control was taken is not a press.
  buttonState = primeButtons(store.config, found.state, buttonState)
  buttonsFor = store.config
  flyingOn = found.pad.id
  store.setMessage(null)
  store.setActive(true)
  shell()?.app.setBackgroundThrottling(false)
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
  flyingOn = null
  shell()?.app.setBackgroundThrottling(true)
  if (reason) store.setMessage(reason)
  // The release, repeated: this is the message that hands the channels back,
  // and a lost one leaves the vehicle holding the last position.
  for (let i = 0; i < RELEASE_REPEATS; i++) {
    setTimeout(() => sendChannels(RELEASE), i * 60)
  }
}

/**
 * Ask for a flight mode by name, resolved against the vehicle on the link:
 * the number is per vehicle, and a profile made on a copter may be flown on a
 * plane. A name this vehicle has no mode for is said, not guessed at; so is a
 * mode the vehicle declined, which the ack alone does not show.
 */
function requestMode(name: string): void {
  const vehicleType = useVehicleStore.getState().vehicleType
  const number = modeNumberByName(vehicleType, name)
  const store = useJoystickStore.getState()
  store.setMessage(null)
  if (number === undefined) {
    store.setMessage(`This vehicle has no ${name} mode`)
    return
  }
  void setModeConfirmed(number).then((result) => {
    if (result !== 0) useJoystickStore.getState().setMessage(`${name} was refused`)
  })
}

function send(): void {
  if (useConnectionStore.getState().phase !== 'connected') {
    stop('The link dropped')
    return
  }
  const read = tick()
  // tick() has already released for an unplug or a device change; there is
  // nothing to send.
  if (!read || !useJoystickStore.getState().active) return
  sendChannels(read.channels)
}

function sendChannels(channels: readonly number[]): void {
  const sysid = useVehicleStore.getState().sysid || 1
  const fields: Record<string, number> = { targetSystem: sysid, targetComponent: 1 }
  for (let i = 0; i < OVERRIDE_FIELDS; i++) fields[`chan${i + 1}Raw`] = channels[i] ?? 0
  connectionService.sendMessage('RC_CHANNELS_OVERRIDE', fields)
}

/** The things that must stop it, wired once. */
function attachGuards(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('gamepaddisconnected', (e) => {
    if (flyingOn !== null && (e as GamepadEvent).gamepad?.id === flyingOn) {
      stop('The gamepad was unplugged')
    }
  })
  // Only a browser releases on losing focus: the desktop shell keeps an
  // unfocused window's gamepad input live (see enable), a browser may not.
  window.addEventListener('blur', () => {
    if (!shell()) stop('The window lost focus')
  })
  // Hidden means the platform has stopped updating the pad, in either: the
  // shell turns throttling off so this does not happen, and if it happens
  // anyway the sticks are frozen and must be let go.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('The window was hidden')
  })
}
