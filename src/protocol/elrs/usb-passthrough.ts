// Writing a board's onboard ELRS receiver (an ESP32) through the flight
// controller's own USB port. ArduPilot pulls the ESP32's BOOT strap and EN
// pin through two relays to put it in its ROM loader, then forwards the USB
// port to the receiver's UART (SERIAL_PASSn) so esptool can talk to it.
// The specification is LoftedAero-SRX's `docs/elrs_usb_flashing.md`; the
// steps below carry its numbers.
//
// Pure sequencing over a narrow link, so it is tested against a strict fake
// and the services layer binds it to the real connection and to esptool.

import type { ReceiverWiring } from '../lofted-boards'

/** The relays used while the receiver is written: RELAY1 on BOOT, RELAY2 on EN. */
export const BOOT_RELAY = 1
export const EN_RELAY = 2
/** Passthrough ends after this many seconds without USB traffic. */
export const PASS_TIMEOUT_S = 5
/** The receiver protocol left on the port afterwards (RCIN). */
export const RCIN_PROTOCOL = 23

const MAV_RESULT_ACCEPTED = 0

export interface PassthroughLink {
  armed(): boolean
  /** The value the vehicle holds now; rejects when it has no such parameter. */
  readParam(name: string): Promise<number>
  /** Every parameter from the last download, to find what exists without asking for each. */
  knownParams(): ReadonlyMap<string, number>
  /** Write, and resolve with the vehicle's echoed value. */
  writeParam(name: string, value: number): Promise<number>
  /**
   * MAV_CMD_DO_SET_RELAY, `instance` 0-based. Resolves with the MAV_RESULT,
   * or -1 when nothing answered.
   */
  setRelay(instance: number, high: boolean): Promise<number>
  /** Reboot the flight controller and resolve once its heartbeat is back. */
  reboot(): Promise<void>
  /** Close MAVLink and let go of the port. */
  closeLink(): Promise<void>
  /** Reopen MAVLink on the same port; true once a heartbeat arrives. */
  openLink(timeoutMs: number): Promise<boolean>
  sleep(ms: number): Promise<void>
}

/** Where saved values are kept, so an interrupted run can be put right later. */
export interface SavedState {
  load(): Record<string, number> | null
  save(values: Record<string, number>): void
  clear(): void
}

export type PassthroughStep =
  | 'configure'
  | 'reboot'
  | 'download-mode'
  | 'passthrough'
  | 'esptool'
  | 'wait-exit'
  | 'boot-receiver'
  | 'restore'
  | 'verify'

export class VehicleArmedError extends Error {
  constructor() {
    super('The vehicle is armed. Disarm it before writing the receiver.')
    this.name = 'VehicleArmedError'
  }
}

const relayParams = (n: number) => [`RELAY${n}_FUNCTION`, `RELAY${n}_PIN`, `RELAY${n}_DEFAULT`]
const serialProtocol = (w: ReceiverWiring) => `SERIAL${w.serial}_PROTOCOL`

/** The settings the write needs. `DEFAULT=1` keeps EN released at boot, or the receiver stays in reset. */
export function setupParams(
  w: ReceiverWiring,
  passthroughProtocol: number,
): Record<string, number> {
  return {
    [serialProtocol(w)]: passthroughProtocol,
    [`RELAY${BOOT_RELAY}_FUNCTION`]: 1,
    [`RELAY${BOOT_RELAY}_PIN`]: w.bootPin,
    [`RELAY${BOOT_RELAY}_DEFAULT`]: 1,
    [`RELAY${EN_RELAY}_FUNCTION`]: 1,
    [`RELAY${EN_RELAY}_PIN`]: w.enPin,
    [`RELAY${EN_RELAY}_DEFAULT`]: 1,
  }
}

/**
 * The settings left behind. Clearing the relays is a safety requirement: a
 * relay on EN that a switch, a mission item or a GCS button can reach kills
 * the receiver in flight.
 */
export function finalParams(
  w: ReceiverWiring,
  saved: Record<string, number> | null,
): Record<string, number> {
  const out: Record<string, number> = {
    [serialProtocol(w)]: RCIN_PROTOCOL,
    [`RELAY${BOOT_RELAY}_FUNCTION`]: 0,
    [`RELAY${BOOT_RELAY}_PIN`]: -1,
    [`RELAY${EN_RELAY}_FUNCTION`]: 0,
    [`RELAY${EN_RELAY}_PIN`]: -1,
  }
  if (saved && 'SERIAL_PASSTIMO' in saved) out.SERIAL_PASSTIMO = saved.SERIAL_PASSTIMO!
  return out
}

/** What is saved before anything is changed. */
export function savedParamNames(w: ReceiverWiring): string[] {
  return [
    serialProtocol(w),
    ...relayParams(BOOT_RELAY),
    ...relayParams(EN_RELAY),
    'SERIAL_PASSTIMO',
  ]
}

/**
 * Whether a board is still configured for writing its receiver: a run that
 * stopped before its last step. `params` is what the vehicle reported;
 * `passthroughProtocols` are the values any of the board's firmware options
 * uses while writing.
 */
export function interruptedRun(
  params: ReadonlyMap<string, number>,
  w: ReceiverWiring,
  passthroughProtocols: ReadonlySet<number>,
): boolean {
  for (const [name, value] of params) {
    if (/^RELAY\d+_PIN$/.test(name) && (value === w.bootPin || value === w.enPin)) return true
  }
  const proto = params.get(serialProtocol(w))
  return proto !== undefined && passthroughProtocols.has(proto)
}

export type WriteOutcome =
  /** Written and restored. `esptoolError` is set when the write itself failed; the settings are restored either way. */
  | { kind: 'done'; esptoolError: string | null }
  /**
   * The flight controller sends heartbeats but ignores what it receives
   * after the passthrough ends (stock ArduPilot). The user must disconnect
   * and reconnect USB; then `restore` finishes.
   */
  | { kind: 'replug'; esptoolError: string | null }

export interface PassthroughOptions {
  link: PassthroughLink
  wiring: ReceiverWiring
  passthroughProtocol: number
  state: SavedState
  onStep?: (step: PassthroughStep) => void
}

async function relay(link: PassthroughLink, n: number, high: boolean, tries = 3): Promise<boolean> {
  // The first command after a reconnect sometimes goes unanswered, and the
  // command is idempotent, so it is simply sent again.
  for (let i = 0; i < tries; i++) {
    if ((await link.setRelay(n - 1, high)) === MAV_RESULT_ACCEPTED) return true
  }
  return false
}

async function mustRelay(link: PassthroughLink, n: number, high: boolean) {
  if (!(await relay(link, n, high))) {
    throw new Error(`The flight controller did not accept the relay ${n} command.`)
  }
}

/** Write each value the vehicle does not already hold; true if anything changed. */
async function apply(link: PassthroughLink, params: Record<string, number>): Promise<boolean> {
  let changed = false
  for (const [name, value] of Object.entries(params)) {
    if ((await link.readParam(name)) === value) continue
    const echoed = await link.writeParam(name, value)
    if (Math.abs(echoed - value) > 0.01) throw new Error(`${name} did not take the value ${value}.`)
    changed = true
  }
  return changed
}

/**
 * Steps 1 to 9: put the receiver in its ROM loader, run esptool through the
 * flight controller, then restore the flight controller's settings.
 */
export async function writeReceiver(
  opts: PassthroughOptions,
  esptool: () => Promise<void>,
): Promise<WriteOutcome> {
  const { link, wiring, state } = opts
  const step = (s: PassthroughStep) => opts.onStep?.(s)
  if (link.armed()) throw new VehicleArmedError()

  // 1. Save. A copy from an interrupted run is kept: it holds the values from
  // before that run, which the current ones are not.
  if (!state.load()) {
    const saved: Record<string, number> = {}
    for (const name of savedParamNames(wiring)) saved[name] = await link.readParam(name)
    state.save(saved)
  }

  // 2-3. Configure, and reboot if that changed anything.
  step('configure')
  if (await apply(link, setupParams(wiring, opts.passthroughProtocol))) {
    step('reboot')
    await link.reboot()
    if (link.armed()) throw new VehicleArmedError()
  }

  // 4. Hold BOOT low and pulse EN: the ESP32 starts its ROM loader.
  step('download-mode')
  await mustRelay(link, EN_RELAY, true)
  await mustRelay(link, BOOT_RELAY, true)
  await link.sleep(200)
  await mustRelay(link, BOOT_RELAY, false)
  await link.sleep(100)
  await mustRelay(link, EN_RELAY, false)
  await link.sleep(300)
  await mustRelay(link, EN_RELAY, true)
  await link.sleep(500)
  await mustRelay(link, BOOT_RELAY, true)

  // 5. Passthrough. SERIAL_PASSn goes last: ArduPilot waits a second before
  // forwarding, so its echo still arrives, but MAVLink on this port then stops.
  step('passthrough')
  await link.writeParam('SERIAL_PASSTIMO', PASS_TIMEOUT_S)
  await link.writeParam('SERIAL_PASS1', 0)
  await link.writeParam('SERIAL_PASS2', wiring.serial).catch(() => wiring.serial)
  await link.closeLink()
  await link.sleep(2000)

  // 6. esptool, on the same port. A failure still runs the exit and the restore.
  step('esptool')
  let esptoolError: string | null = null
  try {
    await esptool()
  } catch (e) {
    esptoolError = e instanceof Error ? e.message : String(e)
  }

  // 7. Passthrough ends after PASS_TIMEOUT_S without USB traffic.
  step('wait-exit')
  await link.sleep((PASS_TIMEOUT_S + 2) * 1000)
  if (!(await link.openLink(30000))) return { kind: 'replug', esptoolError }

  // 8. Boot the new firmware. No answer here is stock ArduPilot's bug: the
  // port still belongs to the passthrough until a reboot. One unanswered
  // command (with the link's own retries) shows it; three kept the pilot
  // waiting about 20 s for the replug prompt.
  step('boot-receiver')
  await link.sleep(1000)
  if (!(await bootReceiver(link, 1))) {
    await link.closeLink()
    return { kind: 'replug', esptoolError }
  }

  // 9.
  await restoreSettings(link, wiring, state, step)
  return { kind: 'done', esptoolError }
}

/** BOOT released, EN pulsed: the ESP32 starts its firmware. */
async function bootReceiver(link: PassthroughLink, firstTries = 3): Promise<boolean> {
  if (!(await relay(link, BOOT_RELAY, true, firstTries))) return false
  if (!(await relay(link, EN_RELAY, false))) return false
  await link.sleep(100)
  return relay(link, EN_RELAY, true)
}

/** Step 9: receiver back on RCIN, relays cleared, reboot, read back. */
async function restoreSettings(
  link: PassthroughLink,
  wiring: ReceiverWiring,
  state: SavedState,
  step: (s: PassthroughStep) => void,
) {
  step('restore')
  const final = finalParams(wiring, state.load())
  // Any other relay left on BOOT or EN is as dangerous as ours.
  for (const [name, pin] of link.knownParams()) {
    const n = /^RELAY(\d+)_PIN$/.exec(name)?.[1]
    if (n && (pin === wiring.bootPin || pin === wiring.enPin)) {
      final[`RELAY${n}_FUNCTION`] = 0
      final[`RELAY${n}_PIN`] = -1
    }
  }
  await apply(link, final)
  await link.reboot()
  step('verify')
  for (const [name, value] of Object.entries(final)) {
    const now = await link.readParam(name)
    if (Math.abs(now - value) > 0.01)
      throw new Error(`${name} reads ${now} after the restore, not ${value}.`)
  }
  state.clear()
}

/**
 * Finish a run that stopped before step 9, after a replug or on the next
 * connection. Boots the receiver first if the relays still allow it.
 */
export async function restoreReceiver(opts: PassthroughOptions): Promise<void> {
  const { link, wiring, state } = opts
  const step = (s: PassthroughStep) => opts.onStep?.(s)
  if (link.armed()) throw new VehicleArmedError()
  const enRelay =
    (await link.readParam(`RELAY${EN_RELAY}_FUNCTION`).catch(() => 0)) === 1 &&
    (await link.readParam(`RELAY${EN_RELAY}_PIN`).catch(() => -1)) === wiring.enPin
  if (enRelay) {
    step('boot-receiver')
    await bootReceiver(link)
  }
  await restoreSettings(link, wiring, state, step)
}
