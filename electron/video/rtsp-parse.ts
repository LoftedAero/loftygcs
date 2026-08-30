// The text half of RTSP: parsing responses, reading an SDP, and answering an
// authentication challenge. Kept apart from the socket so it can be tested
// against captured strings from real cameras rather than against a camera.

import { createHash } from 'node:crypto'

export interface RtspResponse {
  status: number
  reason: string
  headers: Record<string, string>
  body: string
}

/** Header names are case-insensitive, so they are lower-cased on the way in. */
export function parseResponse(text: string): RtspResponse | null {
  const split = text.indexOf('\r\n\r\n')
  const head = split < 0 ? text : text.slice(0, split)
  const body = split < 0 ? '' : text.slice(split + 4)
  const lines = head.split('\r\n')
  const statusLine = lines.shift()
  if (!statusLine) return null
  const m = /^RTSP\/1\.\d\s+(\d{3})\s*(.*)$/.exec(statusLine)
  if (!m) return null
  const headers: Record<string, string> = {}
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
  }
  return { status: Number(m[1]), reason: m[2] ?? '', headers, body }
}

export interface VideoTrack {
  /** Payload type the sender will use. */
  payloadType: number
  /** Absolute or relative control URL for SETUP. */
  control: string
  encoding: string
  sps: Uint8Array | null
  pps: Uint8Array | null
}

/**
 * Pulls the video track out of an SDP.
 *
 * Only H.264 is understood. The parameter sets in `sprop-parameter-sets` are
 * worth having even though they usually also arrive in-band: with them the
 * decoder can be configured before the first packet, so the first keyframe
 * is displayed rather than discarded for want of an SPS.
 */
export function parseSdp(sdp: string): VideoTrack | null {
  const lines = sdp.split(/\r?\n/)
  let inVideo = false
  let payloadType = -1
  let control = ''
  let encoding = ''
  let sps: Uint8Array | null = null
  let pps: Uint8Array | null = null

  for (const line of lines) {
    if (line.startsWith('m=')) {
      // Any second media section (audio, metadata) ends the video one.
      if (inVideo) break
      const m = /^m=video\s+\d+\s+\S+\s+(\d+)/.exec(line)
      if (m) {
        inVideo = true
        payloadType = Number(m[1])
      }
      continue
    }
    if (!inVideo) continue
    if (line.startsWith('a=control:')) control = line.slice('a=control:'.length).trim()
    else if (line.startsWith('a=rtpmap:')) {
      const m = /^a=rtpmap:(\d+)\s+([\w-]+)/.exec(line)
      if (m) {
        payloadType = Number(m[1])
        encoding = (m[2] ?? '').toUpperCase()
      }
    } else if (line.startsWith('a=fmtp:')) {
      const m = /sprop-parameter-sets=([^;\s]+)/.exec(line)
      if (m) {
        const [a, b] = m[1]!.split(',')
        if (a) sps = decodeBase64(a)
        if (b) pps = decodeBase64(b)
      }
    }
  }
  if (!inVideo || payloadType < 0) return null
  return { payloadType, control, encoding: encoding || 'H264', sps, pps }
}

function decodeBase64(s: string): Uint8Array | null {
  try {
    const buf = Buffer.from(s, 'base64')
    return buf.length > 0 ? new Uint8Array(buf) : null
  } catch {
    return null
  }
}

/**
 * Resolves a track's control URL against the stream's.
 *
 * `a=control:*` means "the stream URL itself", a relative value hangs off it,
 * and an absolute one replaces it -- which cameras use inconsistently enough
 * that all three have to be handled.
 */
export function resolveControl(base: string, control: string): string {
  if (!control || control === '*') return base
  if (/^rtsps?:\/\//i.test(control)) return control
  return base.endsWith('/') ? base + control : `${base}/${control}`
}

export interface AuthChallenge {
  scheme: 'basic' | 'digest'
  realm: string
  nonce?: string
}

/** Reads a WWW-Authenticate header. Returns null for schemes we cannot answer. */
export function parseChallenge(header: string | undefined): AuthChallenge | null {
  if (!header) return null
  const scheme = /^(\w+)/.exec(header)?.[1]?.toLowerCase()
  const realm = /realm="([^"]*)"/i.exec(header)?.[1] ?? ''
  if (scheme === 'basic') return { scheme: 'basic', realm }
  if (scheme === 'digest') {
    const nonce = /nonce="([^"]*)"/i.exec(header)?.[1] ?? ''
    return { scheme: 'digest', realm, nonce }
  }
  return null
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

/** The Authorization header value for a challenge, or null without credentials. */
export function authorization(
  challenge: AuthChallenge,
  method: string,
  uri: string,
  user: string,
  pass: string,
): string | null {
  if (!user && !pass) return null
  if (challenge.scheme === 'basic') {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
  }
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`)
  const ha2 = md5(`${method}:${uri}`)
  const response = md5(`${ha1}:${challenge.nonce ?? ''}:${ha2}`)
  return (
    `Digest username="${user}", realm="${challenge.realm}", ` +
    `nonce="${challenge.nonce ?? ''}", uri="${uri}", response="${response}"`
  )
}

export interface ParsedUrl {
  host: string
  port: number
  /** The URL with any credentials stripped, which is what goes on the wire. */
  url: string
  user: string
  pass: string
}

/**
 * Splits an rtsp:// URL into what the socket and the requests each need.
 *
 * Credentials in the URL are common for cameras and must not be sent as part
 * of the request line -- they belong in an Authorization header, and leaving
 * them in the URL leaks the password into the camera's logs.
 */
export function parseRtspUrl(input: string): ParsedUrl | null {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  if (u.protocol !== 'rtsp:' && u.protocol !== 'rtsps:') return null
  const user = decodeURIComponent(u.username)
  const pass = decodeURIComponent(u.password)
  u.username = ''
  u.password = ''
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 554,
    url: u.toString(),
    user,
    pass,
  }
}
