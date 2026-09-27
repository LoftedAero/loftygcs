// @vitest-environment node
//
// The RTSP client against a minimal fake server: the handshake sequence, the
// interleaved framing that carries RTP on the same socket as the replies, and
// whether an access unit comes out. A subtly wrong SETUP connects fine and
// never shows a picture.

import net from 'node:net'
import dgram from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { openSource } from './source'
import type { AccessUnit } from './h264'

const SPS = Uint8Array.of(0x67, 0x42, 0xe0, 0x1e, 0xaa)
const PPS = Uint8Array.of(0x68, 0xce)

function sdp(): string {
  const b64 = (a: Uint8Array) => Buffer.from(a).toString('base64')
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=Test',
    'm=video 0 RTP/AVP 96',
    'a=rtpmap:96 H264/90000',
    `a=fmtp:96 packetization-mode=1;sprop-parameter-sets=${b64(SPS)},${b64(PPS)}`,
    'a=control:trackID=0',
    '',
  ].join('\r\n')
}

/** One RTP packet wrapped in the `$` interleaved framing RTSP uses over TCP. */
function interleaved(payload: number[], seq: number, marker: boolean): Buffer {
  const rtp = Buffer.alloc(12 + payload.length)
  rtp[0] = 0x80
  rtp[1] = (marker ? 0x80 : 0) | 96
  rtp.writeUInt16BE(seq, 2)
  rtp.writeUInt32BE(9000, 4)
  Buffer.from(payload).copy(rtp, 12)
  const frame = Buffer.alloc(4 + rtp.length)
  frame[0] = 0x24
  frame[1] = 0
  frame.writeUInt16BE(rtp.length, 2)
  rtp.copy(frame, 4)
  return frame
}

interface Fake {
  port: number
  close(): Promise<void>
  /** Requests the client made, in order. */
  methods: string[]
}

/** A server that answers the handshake, then interleaves one keyframe. */
function startServer(opts: { auth?: boolean } = {}): Promise<Fake> {
  const methods: string[] = []
  let challenged = false
  const server = net.createServer((socket) => {
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString('latin1')
      for (;;) {
        const end = buf.indexOf('\r\n\r\n')
        if (end < 0) return
        const req = buf.slice(0, end)
        buf = buf.slice(end + 4)
        const method = req.split(' ')[0] ?? ''
        const cseq = /CSeq:\s*(\d+)/i.exec(req)?.[1] ?? '0'
        methods.push(method)

        if (opts.auth && !challenged && !/Authorization:/i.test(req)) {
          challenged = true
          socket.write(
            `RTSP/1.0 401 Unauthorized\r\nCSeq: ${cseq}\r\n` +
              `WWW-Authenticate: Digest realm="Test", nonce="n0"\r\n\r\n`,
          )
          continue
        }

        if (method === 'DESCRIBE') {
          const body = sdp()
          socket.write(
            `RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nContent-Type: application/sdp\r\n` +
              `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
          )
        } else if (method === 'SETUP') {
          socket.write(
            `RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nSession: 4242;timeout=60\r\n` +
              `Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\n\r\n`,
          )
        } else if (method === 'PLAY') {
          socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nSession: 4242\r\n\r\n`)
          // An IDR split across two FU-A packets, as a real one would be.
          const ind = 0x60 | 28
          socket.write(interleaved([ind, 0x80 | 5, 0x11, 0x22], 1, false))
          socket.write(interleaved([ind, 0x40 | 5, 0x33], 2, true))
        } else {
          socket.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\n\r\n`)
        }
      }
    })
    socket.on('error', () => undefined)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({
        port,
        methods,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

let running: { close(): void } | null = null
let fake: Fake | null = null

afterEach(async () => {
  running?.close()
  running = null
  await fake?.close()
  fake = null
})

/** Resolves on the first access unit, or rejects with whatever went wrong. */
function firstUnit(url: string, ms = 5000) {
  return new Promise<{ codec: string; unit: AccessUnit }>((resolve, reject) => {
    let codec = ''
    const source = openSource(url)
    running = source
    const timer = setTimeout(() => reject(new Error('no access unit arrived')), ms)
    source.on('ready', (info) => {
      codec = info.codec
    })
    source.on('unit', (unit) => {
      clearTimeout(timer)
      resolve({ codec, unit })
    })
    source.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('RTSP source', () => {
  it('completes the handshake and delivers a keyframe', async () => {
    fake = await startServer()
    const { codec, unit } = await firstUnit(`rtsp://127.0.0.1:${fake.port}/stream`)

    // The codec string comes from the SDP, so the decoder can be configured
    // before the first keyframe arrives.
    expect(codec).toBe('avc1.42e01e')
    expect(unit.keyframe).toBe(true)
    // Parameter sets ahead of the reassembled IDR.
    const bytes = [...unit.data]
    expect(bytes.slice(0, 4)).toEqual([0, 0, 0, 1])
    expect(bytes.slice(4, 9)).toEqual([...SPS])
    expect(bytes.slice(-4)).toEqual([0x65, 0x11, 0x22, 0x33])
  })

  it('asks in the order RTSP requires', async () => {
    fake = await startServer()
    await firstUnit(`rtsp://127.0.0.1:${fake.port}/stream`)
    expect(fake.methods).toEqual(['DESCRIBE', 'SETUP', 'PLAY'])
  })

  it('answers a digest challenge and carries on', async () => {
    // Cameras almost always challenge.
    fake = await startServer({ auth: true })
    const { unit } = await firstUnit(`rtsp://user:pass@127.0.0.1:${fake.port}/stream`)
    expect(unit.keyframe).toBe(true)
    expect(fake.methods.filter((m) => m === 'DESCRIBE')).toHaveLength(2)
  })

  it('reports a refused connection rather than hanging', async () => {
    // Port 1 is reliably closed.
    await expect(firstUnit('rtsp://127.0.0.1:1/stream', 4000)).rejects.toThrow()
  })

  it('rejects a URL that is not RTSP', async () => {
    await expect(firstUnit('http://127.0.0.1/stream', 3000)).rejects.toThrow(/Not an RTSP URL/)
  })
})

describe('UDP source', () => {
  it('says so when the port is already taken', async () => {
    // With SO_REUSEADDR a second bind succeeds but the first socket keeps
    // the datagrams, so the client would report "Listening" and show nothing
    // (for example, with another GCS on the same video port).
    const held = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const port = await new Promise<number>((resolve) => {
      held.bind(0, '0.0.0.0', () => resolve(held.address().port))
    })
    try {
      await expect(firstUnit(`udp://:${port}`, 4000)).rejects.toThrow(/already in use/i)
    } finally {
      held.close()
    }
  })
})
