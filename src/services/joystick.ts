import { connectionService } from './connection'
import { useConnectionStore } from '../stores/connection-store'
import { useJoystickStore } from '../stores/joystick-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { setModeConfirmed } from './flight'
import { modeNumberByName } from '../protocol/modes'
import { announce } from './voice/announcer'
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

// Flying with a gamepad. ArduPilot treats RC_CHANNELS_OVERRIDE exactly like a
// receiver, so:
//
//  1. It is off at every start and never persisted.
//  2. It refuses to start unless the self-centering sticks are centered. The
//     throttle is taken wherever it is, so control can be taken in flight.
//  3. It stops itself when the pad is unplugged or changes, when the link
//     drops, and whenever gamepad input may no longer be live (below).
//  4. Stopping means sending the release, not going quiet; the release value
//     differs above channel 8 (protocol/joystick.ts).
//
// The reading loop runs for the whole session, not only while the Joystick
// pane is open. In the desktop app, taking control turns off background
// throttling so an unfocused or covered window keeps reading the pad. A
// browser has no such switch and may freeze gamepad data, so there losing
// focus releases. A hidden page releases in both.

/** 20 Hz: comparable to a transmitter, and well inside any override timeout. */
const SEND_INTERVAL_MS = 50
/** Fast enough to catch a button press. */
const POLL_INTERVAL_MS = 33
/** The release is repeated so one lost packet cannot leave the channels held. */
const RELEASE_REPEATS = 3

let pollTimer: ReturnType<typeof setInterval> | null = null
let sendTimer: ReturnType<typeof setInterval> | null = null
let listening = false
let buttonState: ButtonState | null = null
/**
 * The mapping `buttonState` was built for. A new mapping starts over, primed
 * with the buttons currently held, so the press that just taught a switch
 * does not also step it.
 */
let buttonsFor: JoystickConfig | null = null
/** The device control was taken on; a different one mid-flight releases. */
let flyingOn: string | null = null

/** The desktop shell, if present, which can keep an unfocused window live. */
const shell = () => (typeof window !== 'undefined' ? window.loftgcs : undefined)

/** Connected devices, in the browser's index order. */
function connectedPads(): Gamepad[] {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return []
  const out: Gamepad[] = []
  // getGamepads() is sparse; each pad keeps its own `index`.
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) out.push(pad)
  return out
}

/**
 * The device to read, or null when undecided. With several attached, the
 * browser's enumeration order is arbitrary, so nothing is read (and `enable`
 * refuses) until the user chooses one.
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
 * One read of the pad: updates the live state, steps the buttons, and runs
 * the checks that release control. Shared by the poll and the send.
 */
function tick(): { channels: number[] } | null {
  const store = useJoystickStore.getState()
  const pads = connectedPads().map((p) => ({ index: p.index, id: p.id }))
  const found = readPad()
  store.setPads(pads, found ? { index: found.pad.index, id: found.pad.id } : null)
  if (!found) {
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
  // Mode buttons act only while the gamepad has control.
  if (stepped.modePressed && store.active) requestMode(stepped.modePressed)
  const channels = channelsFor(found.state, config, buttonState)
  store.setLive(found.state.axes as number[], found.state.buttons as boolean[], channels)
  return { channels }
}

/** Starts reading the pad (idempotent). Nothing is sent until `enable`. */
export function startReading(): void {
  if (pollTimer) return
  attachGuards()
  pollTimer = setInterval(tick, POLL_INTERVAL_MS)
}

/** Stops reading, releasing first if control is taken. For tests and teardown. */
export function stopReading(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (useJoystickStore.getState().active) stop('Joystick reading stopped')
}

/** Takes control. Returns the reason it was refused, or null when it started. */
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
  // not snap them to their first position.
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

/** Hands control back, recording the reason if one is given. */
export function stop(reason?: string): void {
  if (sendTimer) clearInterval(sendTimer)
  sendTimer = null
  const store = useJoystickStore.getState()
  if (!store.active) return
  store.setActive(false)
  flyingOn = null
  shell()?.app.setBackgroundThrottling(true)
  if (reason) {
    store.setMessage(reason)
    // Released by itself (unplugged, replaced, link dropped), not by the user.
    announce({ t: 'joystick' })
  }
  // Repeated: a lost release leaves the vehicle holding the last position.
  for (let i = 0; i < RELEASE_REPEATS; i++) {
    setTimeout(() => sendChannels(RELEASE), i * 60)
  }
}

/**
 * Requests a flight mode by name, resolved against the connected vehicle
 * since mode numbers differ by vehicle type. Reports an unknown name or a
 * refused change.
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
  // tick() has already released for an unplug or device change.
  if (!read || !useJoystickStore.getState().active) return
  sendChannels(read.channels)
}

function sendChannels(channels: readonly number[]): void {
  const sysid = useVehicleStore.getState().sysid || 1
  const fields: Record<string, number> = { targetSystem: sysid, targetComponent: 1 }
  for (let i = 0; i < OVERRIDE_FIELDS; i++) fields[`chan${i + 1}Raw`] = channels[i] ?? 0
  connectionService.sendMessage('RC_CHANNELS_OVERRIDE', fields)
}

/** Wires the events that release control, once. */
function attachGuards(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('gamepaddisconnected', (e) => {
    if (flyingOn !== null && (e as GamepadEvent).gamepad?.id === flyingOn) {
      stop('The gamepad was unplugged')
    }
  })
  // Only a browser releases on blur; the desktop shell keeps an unfocused
  // window's gamepad input live.
  window.addEventListener('blur', () => {
    if (!shell()) stop('The window lost focus')
  })
  // A hidden page may stop receiving gamepad updates, so release in both.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('The window was hidden')
  })
}
