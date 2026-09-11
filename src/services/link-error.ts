import type { TransportOptions } from '../transport/Transport'

// What to say when a link will not open.
//
// `Transport.open` is documented as rejecting with "a user-readable Error",
// and the IP transports never honored that: they reject with whatever Node
// threw, and Electron then wraps a rejected `ipcMain.handle` in its own
// sentence. Connecting to a simulator that was not running put this on the
// app bar:
//
//   Error invoking remote method 'link:open': Error: connect ECONNREFUSED
//   127.0.0.1:5760
//
// -- which names an IPC channel the user has never heard of, buries the one
// useful word in the middle, and is far too long for the place it is shown.
//
// The codes are the interesting part and they are stable across platforms,
// so they are matched rather than the messages around them. Anything without
// a code falls through to the cleaned text: an unknown failure said plainly
// is better than a wrong guess said confidently.

/** Electron's wrapper around a rejected `ipcMain.handle`. */
const IPC_WRAPPER = /Error invoking remote method '[^']*':\s*/g
/** The `Error: ` / `DOMException: ` a thrown object stringifies with. */
const THROWN_PREFIX = /^(?:Error|DOMException|TypeError):\s*/

/** The raw text, with the plumbing taken off the front. */
export function cleanMessage(raw: string): string {
  let out = raw.replace(IPC_WRAPPER, '')
  // The prefix can survive twice over: Electron's wrapper contains one.
  while (THROWN_PREFIX.test(out)) out = out.replace(THROWN_PREFIX, '')
  return out.trim()
}

/**
 * Closing the browser's port chooser, which is not a failure.
 *
 * Web Serial rejects `requestPort()` with NotFoundError when someone presses
 * Cancel. Reported as an error it puts a red chip on the bar for choosing
 * not to connect.
 */
export function isCancellation(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'NotFoundError') return true
  const msg = err instanceof Error ? err.message : String(err)
  return /No port selected by the user/i.test(msg)
}

/** What the user asked to connect to, in their own terms. */
export function linkTarget(opts: TransportOptions): string {
  switch (opts.kind) {
    case 'tcp':
      return `${opts.host}:${opts.port}`
    case 'udp':
      return `port ${opts.localPort}`
    case 'ws':
      return opts.url
    case 'serial':
      return 'the serial port'
    case 'virtual':
      return 'the demo vehicle'
  }
}

const BY_CODE: Record<string, (target: string) => string> = {
  // The one this was written for: the far end is reachable and refusing,
  // which for a simulator means it is not running.
  ECONNREFUSED: (t) => `Nothing is listening at ${t}.`,
  ETIMEDOUT: (t) => `${t} did not respond.`,
  EHOSTUNREACH: (t) => `${t} is unreachable.`,
  ENETUNREACH: (t) => `${t} is unreachable.`,
  ENOTFOUND: (t) => `Cannot find ${t}.`,
  // Binding, not connecting: a UDP link or a second copy of this app.
  EADDRINUSE: (t) => `Something is already using ${t}.`,
  EACCES: (t) => `Not allowed to open ${t}.`,
  ECONNRESET: (t) => `${t} closed the connection.`,
  EPIPE: (t) => `${t} closed the connection.`,
}

// Built with `String.raw`: in an ordinary template literal \b is a
// backspace character, not a word boundary, and the regex then matches
// nothing at all -- every error falls through to its raw text and the
// mapping above looks like it simply does not work.
const CODE = new RegExp(String.raw`\b(${Object.keys(BY_CODE).join('|')})\b`)

/**
 * One sentence for a link that would not open, or null if it was cancelled.
 *
 * Null means "say nothing and go back to idle" -- see `connect()`.
 */
export function describeLinkError(err: unknown, opts: TransportOptions): string | null {
  if (isCancellation(err)) return null
  const raw = err instanceof Error ? err.message : String(err)
  const message = cleanMessage(raw)
  const code = CODE.exec(message)?.[1]
  if (code) return BY_CODE[code]!(linkTarget(opts))
  return message || 'The connection failed.'
}

/**
 * Flight-controller USB vendors, for telling "wrong port" from "wrong kind
 * of thing plugged in".
 *
 * Deliberately vendors rather than vendor/product pairs, and deliberately
 * short. The point is not to identify the board -- `identifyBoard` does that
 * properly, by asking its bootloader -- but to decide which of two sentences
 * is more useful when a port opens and then says nothing. Getting it wrong
 * in either direction costs a slightly-off hint, never a wrong action.
 *
 * `0x1209` is the generic ArduPilot/pid.codes vendor, measured on the bench
 * as the Cube's own (`VID_1209&PID_5740`); `0x2dae` is CubePilot and
 * `0x26ac` Hex/3DR.
 */
const FC_VENDORS = new Set([0x1209, 0x2dae, 0x26ac])

/**
 * Why a serial link opened, stayed open, and never said anything.
 *
 * The generic answer covers a wrong baud rate, a board running something
 * that is not ArduPilot, and a USB-serial adapter with nothing on the other
 * end. But there is a case worth naming, because the browser cannot: **a
 * flight controller exposes more than one serial port**. A Cube offers
 * MAVLink and SLCAN, and Chrome's port chooser labels neither -- it is the
 * browser's own dialog, outside the page, showing the USB product string
 * rather than the Windows driver name the desktop shell can read. Picking
 * SLCAN opens perfectly well and answers nothing, which reads as a dead
 * vehicle rather than as the wrong port of a healthy one.
 *
 * So when the thing that went quiet is a flight controller's own USB
 * vendor, the likeliest explanation is named.
 *
 * Both branches open on "No heartbeat received", which is Mission Planner's
 * phrase for this condition and therefore the one an ArduPilot user already
 * knows. Only the second sentence differs, by what the port let us work out:
 * the condition is the same either way, and giving it two names would make
 * the same failure look like two.
 */
export function describeSilentLink(usb?: {
  usbVendorId?: number | undefined
  usbProductId?: number | undefined
}): string {
  const vendor = usb?.usbVendorId
  if (vendor !== undefined && FC_VENDORS.has(vendor)) {
    return 'No heartbeat received. For flight controllers offering multiple ports, choose the MAVLink port rather than SLCAN.'
  }
  return 'No heartbeat received. Check the connection settings, and that the board is running ArduPilot.'
}
