import { cleanMessage, describeCode } from './link-error'

// What to say when the HUD video stream fails, and whether to try again.
//
// The desktop side forwards whatever Node threw ("connect ECONNREFUSED
// 127.0.0.1:8554"). Codes are matched as for a vehicle link (link-error.ts),
// naming the host the user typed.
//
// Most failures are retried: a camera still booting, a radio link dropping
// out, a streamer restarting. Failures about the request itself are not.

/** Failures that are about what was asked for, not about the network. */
const PERMANENT = [
  /^Not an RTSP URL/i,
  /Only H\.264 is supported/i,
  /has no video track/i,
  /needs credentials/i,
  // Refused or not found: the path or the login is wrong, not the link.
  /DESCRIBE failed: 40[134]/i,
]

/** Whether a failure should be retried rather than reported and left. */
export function isRetryable(raw: string): boolean {
  const message = cleanMessage(raw)
  return !PERMANENT.some((re) => re.test(message))
}

/** The stream's address as the user thinks of it: host:port, or the UDP port. */
export function videoTarget(url: string): string {
  const udp = /^udp:\/\/(?:[^:/]*)?:?(\d+)?/i.exec(url.trim())
  if (udp) return `port ${udp[1] ?? 5600}`
  const rtsp = /^rtsps?:\/\/(?:[^@/]*@)?([^:/]+)(?::(\d+))?/i.exec(url.trim())
  if (rtsp) return `${rtsp[1]}:${rtsp[2] ?? 554}`
  return url.trim()
}

/** One sentence for a failure, in the user's terms. */
export function describeVideoError(raw: string, url: string): string {
  const message = cleanMessage(raw)
  // The field already shows the URL; say what it accepts instead.
  if (/^Not an RTSP URL/i.test(message)) return 'The address must start with rtsp:// or udp://.'
  const sentence = describeCode(message, videoTarget(url)) ?? message
  if (!sentence) return 'The video stream failed.'
  // Desktop-side messages lack a final period; the code sentences have one.
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}
