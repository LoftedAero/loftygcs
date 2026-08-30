// Opening a video source and turning it into access units.
//
// Two kinds, one interface: an RTSP stream (negotiated, then RTP interleaved
// down the same TCP socket) and a bare UDP port that something is already
// sending RTP to. RTSP is carried over TCP rather than negotiating a UDP
// transport because it is one socket instead of three, needs no inbound
// ports open, and works through the NAT a companion computer usually sits
// behind. That costs a little latency against raw UDP, which is why the
// plain `udp://` source exists for setups that stream straight at us.

import net from 'node:net'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'
import { H264Depayloader, codecStringFromSps, parseRtp, type AccessUnit } from './h264'
import {
  authorization,
  parseChallenge,
  parseResponse,
  parseRtspUrl,
  parseSdp,
  resolveControl,
  type AuthChallenge,
} from './rtsp-parse'

export interface VideoSourceEvents {
  /** Emitted once the codec is known, before any access unit. */
  ready: [{ codec: string }]
  unit: [AccessUnit]
  status: [string]
  error: [Error]
  closed: []
}

/** Interleaved RTP framing on the RTSP socket: `$` channel length(16) data. */
const MAGIC = 0x24
const KEEPALIVE_MS = 25_000
const CONNECT_TIMEOUT_MS = 8000

export interface VideoSource {
  close(): void
  on<K extends keyof VideoSourceEvents>(
    event: K,
    listener: (...args: VideoSourceEvents[K]) => void,
  ): void
}

export function openSource(url: string): VideoSource {
  if (/^udp:\/\//i.test(url)) return new UdpSource(url)
  return new RtspSource(url)
}

/** Shared plumbing: a depayloader whose output is emitted as events. */
abstract class BaseSource extends EventEmitter implements VideoSource {
  protected depay = new H264Depayloader()
  private announced = false

  protected feed(datagram: Uint8Array) {
    const pkt = parseRtp(datagram)
    if (!pkt) return
    for (const unit of this.depay.push(pkt)) {
      // The codec string comes from the SPS, so it cannot be announced until
      // one has been seen -- from the SDP if there was one, in-band if not.
      if (!this.announced) {
        const { sps } = this.depay.parameterSets()
        const codec = sps ? codecStringFromSps(sps) : null
        if (!codec) continue
        this.announced = true
        this.emit('ready', { codec })
      }
      this.emit('unit', unit)
    }
  }

  abstract close(): void
}

class UdpSource extends BaseSource {
  private socket: dgram.Socket

  constructor(url: string) {
    super()
    // udp://:5600 and udp://0.0.0.0:5600 both mean "listen here".
    const m = /^udp:\/\/([^:/]*)(?::(\d+))?/i.exec(url)
    const host = m?.[1] || '0.0.0.0'
    const port = Number(m?.[2] ?? 5600)
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('message', (msg) => this.feed(new Uint8Array(msg)))
    this.socket.on('error', (err) => this.emit('error', err))
    this.socket.bind(port, host, () => {
      this.emit('status', `Listening for RTP on ${host}:${port}`)
    })
  }

  close() {
    try {
      this.socket.close()
    } catch {
      // Already closed; nothing to do.
    }
    this.emit('closed')
  }
}

class RtspSource extends BaseSource {
  private socket: net.Socket | null = null
  // Typed loosely so an incoming chunk can be adopted without a copy: the
  // socket hands us Buffer<ArrayBufferLike>, and at video rates copying
  // every chunk into a fresh buffer is real work for nothing.
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private cseq = 1
  private session = ''
  private pending: ((r: ReturnType<typeof parseResponse>) => void) | null = null
  private keepalive: NodeJS.Timeout | null = null
  private closed = false
  private challenge: AuthChallenge | null = null

  constructor(private readonly input: string) {
    super()
    // Deferred so callers can attach listeners before anything is emitted.
    setImmediate(() => void this.run())
  }

  private async run() {
    const parsed = parseRtspUrl(this.input)
    if (!parsed) {
      this.emit('error', new Error(`Not an RTSP URL: ${this.input}`))
      return
    }
    const { host, port, url, user, pass } = parsed
    try {
      this.emit('status', `Connecting to ${host}:${port}…`)
      await this.connect(host, port)
      if (this.closed) return

      const describe = await this.request('DESCRIBE', url, user, pass, {
        Accept: 'application/sdp',
      })
      if (describe.status !== 200) throw new Error(`DESCRIBE failed: ${describe.status} ${describe.reason}`)
      const track = parseSdp(describe.body)
      if (!track) throw new Error('The stream description has no video track')
      if (track.encoding !== 'H264') {
        throw new Error(`Only H.264 is supported; this stream is ${track.encoding}`)
      }
      this.depay.setParameterSets(track.sps, track.pps)

      const control = resolveControl(url, track.control)
      const setup = await this.request('SETUP', control, user, pass, {
        Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
      })
      if (setup.status !== 200) throw new Error(`SETUP failed: ${setup.status} ${setup.reason}`)
      this.session = (setup.headers['session'] ?? '').split(';')[0]!.trim()

      const play = await this.request('PLAY', url, user, pass)
      if (play.status !== 200) throw new Error(`PLAY failed: ${play.status} ${play.reason}`)
      this.emit('status', 'Streaming')

      // Cameras drop an idle session; a periodic no-op keeps it open.
      this.keepalive = setInterval(() => {
        void this.request('OPTIONS', url, user, pass).catch(() => undefined)
      }, KEEPALIVE_MS)
    } catch (err) {
      if (!this.closed) this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.close()
    }
  }

  private connect(host: string, port: number) {
    return new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port })
      socket.setTimeout(CONNECT_TIMEOUT_MS)
      socket.once('connect', () => {
        socket.setTimeout(0)
        socket.setNoDelay(true)
        resolve()
      })
      socket.once('timeout', () => {
        socket.destroy()
        reject(new Error(`No answer from ${host}:${port}`))
      })
      socket.on('error', (err) => {
        if (this.closed) return
        this.emit('error', err)
        reject(err)
      })
      socket.on('close', () => {
        if (!this.closed) this.close()
      })
      socket.on('data', (chunk) => this.onData(chunk))
      this.socket = socket
    })
  }

  /**
   * Reads the socket, which carries two interleaved things: RTSP replies as
   * text, and RTP packets framed with a `$` marker. They have to be pulled
   * apart byte by byte -- a reply can arrive in the middle of the stream.
   */
  private onData(chunk: Buffer) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length === 0) return
      if (this.buffer[0] === MAGIC) {
        if (this.buffer.length < 4) return
        const length = this.buffer.readUInt16BE(2)
        if (this.buffer.length < 4 + length) return
        const channel = this.buffer[1]!
        const payload = this.buffer.subarray(4, 4 + length)
        // Channel 0 is RTP for the track we set up; 1 is its RTCP.
        if (channel === 0) this.feed(new Uint8Array(payload))
        this.buffer = this.buffer.subarray(4 + length)
        continue
      }
      const text = this.buffer.toString('latin1')
      const headEnd = text.indexOf('\r\n\r\n')
      if (headEnd < 0) return
      const head = text.slice(0, headEnd)
      const contentLength = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? 0)
      const total = headEnd + 4 + contentLength
      if (this.buffer.length < total) return
      const response = parseResponse(this.buffer.toString('latin1', 0, total))
      this.buffer = this.buffer.subarray(total)
      const waiting = this.pending
      this.pending = null
      if (waiting) waiting(response)
    }
  }

  private async request(
    method: string,
    uri: string,
    user: string,
    pass: string,
    headers: Record<string, string> = {},
  ): Promise<NonNullable<ReturnType<typeof parseResponse>>> {
    const send = () =>
      new Promise<NonNullable<ReturnType<typeof parseResponse>>>((resolve, reject) => {
        const socket = this.socket
        if (!socket) return reject(new Error('Not connected'))
        const lines = [`${method} ${uri} RTSP/1.0`, `CSeq: ${this.cseq++}`]
        if (this.session) lines.push(`Session: ${this.session}`)
        const auth = this.challenge
          ? authorization(this.challenge, method, uri, user, pass)
          : null
        if (auth) lines.push(`Authorization: ${auth}`)
        for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`)
        lines.push('User-Agent: LoftGCS', '', '')
        this.pending = (r) => (r ? resolve(r) : reject(new Error('Unreadable RTSP response')))
        socket.write(lines.join('\r\n'))
      })

    const first = await send()
    // A 401 on the first try is normal: the challenge is only known after
    // the camera sends it, so the request is repeated once with an answer.
    if (first.status === 401 && !this.challenge) {
      this.challenge = parseChallenge(first.headers['www-authenticate'])
      if (this.challenge && (user || pass)) return send()
      throw new Error('The stream needs credentials; put them in the URL')
    }
    return first
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.keepalive) clearInterval(this.keepalive)
    try {
      this.socket?.destroy()
    } catch {
      // Already gone.
    }
    this.socket = null
    this.emit('closed')
  }
}
