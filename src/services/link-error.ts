import type { TransportOptions } from '../transport/Transport'

// Turns link failures into one short sentence for the app bar.
//
// The IP transports reject with whatever Node threw, and Electron wraps a
// rejected `ipcMain.handle` in its own text, producing e.g.
//
//   Error invoking remote method 'link:open': Error: connect ECONNREFUSED
//   127.0.0.1:5760
//
// Error codes are stable across platforms, so they are matched rather than
// the surrounding wording. Anything without a code falls through to the
// cleaned text rather than a guess.

/** Electron's wrapper around a rejected `ipcMain.handle`. */
const IPC_WRAPPER = /Error invoking remote method '[^']*':\s*/g
/** The `Error: ` / `DOMException: ` a thrown object stringifies with. */
const THROWN_PREFIX = /^(?:Error|DOMException|TypeError):\s*/

/** The raw text with the IPC wrapper and error-type prefixes removed. */
export function cleanMessage(raw: string): string {
  let out = raw.replace(IPC_WRAPPER, '')
  // The prefix can survive twice over: Electron's wrapper contains one.
  while (THROWN_PREFIX.test(out)) out = out.replace(THROWN_PREFIX, '')
  return out.trim()
}

/**
 * Whether the user canceled the port chooser, which is not a failure. Web
 * Serial rejects `requestPort()` with NotFoundError on Cancel.
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
  }
}

const BY_CODE: Record<string, (target: string) => string> = {
  // For a simulator, this means it is not running.
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

// String.raw because in an ordinary template literal \b is a backspace, not
// a word boundary, and the regex would match nothing.
const CODE = new RegExp(String.raw`\b(${Object.keys(BY_CODE).join('|')})\b`)

/**
 * One sentence for a link that would not open, or null if it was canceled
 * (meaning: say nothing and return to idle).
 */
export function describeLinkError(err: unknown, opts: TransportOptions): string | null {
  if (isCancellation(err)) return null
  const raw = err instanceof Error ? err.message : String(err)
  const message = cleanMessage(raw)
  return describeCode(message, linkTarget(opts)) ?? (message || 'The connection failed.')
}

/**
 * The sentence for a network error code in `message`, naming `target`, or
 * null when there is none. Also used by the video stream.
 */
export function describeCode(message: string, target: string): string | null {
  const code = CODE.exec(message)?.[1]
  return code ? BY_CODE[code]!(target) : null
}

/**
 * Flight-controller USB vendors, used only to pick the more useful hint when
 * a port opens and stays silent (`identifyBoard` does real identification).
 * A miss costs a slightly-off hint, never a wrong action.
 *
 * `0x1209` is the generic ArduPilot/pid.codes vendor (a Cube reports
 * `VID_1209&PID_5740`); `0x2dae` is CubePilot and `0x26ac` Hex/3DR.
 */
const FC_VENDORS = new Set([0x1209, 0x2dae, 0x26ac])

/**
 * Explains a serial link that opened but never sent a heartbeat.
 *
 * Flight controllers often expose several ports (a Cube offers MAVLink and
 * SLCAN), and the browser's chooser does not say which is which; SLCAN opens
 * fine and stays silent. So for a flight-controller vendor the hint names
 * that case. "No heartbeat received" is Mission Planner's wording for this.
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
