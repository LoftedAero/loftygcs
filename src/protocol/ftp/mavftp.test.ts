import { describe, expect, it, vi, afterEach } from 'vitest'
import { MavFtpClient } from './mavftp'
import { FtpError, FtpOp, decodeFtpPacket, encodeFtpPacket } from './packet'

// A scripted device on the other end of the client: every sent payload is
// decoded and answered per a tiny in-memory file system.
function scriptedDevice(file: Uint8Array, { dropFirstRead = false } = {}) {
  let dropped = false
  const client: MavFtpClient = new MavFtpClient((payload) => {
    const req = decodeFtpPacket(payload)
    const reply = (opcode: number, data?: Uint8Array, session = req.session) => {
      // Replies echo seq+1; deliver async like a real link.
      queueMicrotask(() =>
        client.handlePayload(
          encodeFtpPacket({ seq: (req.seq + 1) & 0xffff, session, opcode, offset: req.offset, ...(data ? { data } : {}) }),
        ),
      )
    }
    switch (req.opcode) {
      case FtpOp.ResetSessions:
        return reply(FtpOp.Ack)
      case FtpOp.OpenFileRO: {
        const size = new Uint8Array(4)
        new DataView(size.buffer).setUint32(0, file.length, true)
        return reply(FtpOp.Ack, size, 1)
      }
      case FtpOp.ReadFile: {
        if (dropFirstRead && !dropped) {
          dropped = true
          return // lost packet: client must retry
        }
        if (req.offset >= file.length) return reply(FtpOp.Nak, new Uint8Array([FtpError.EndOfFile]))
        return reply(FtpOp.Ack, file.subarray(req.offset, req.offset + req.size))
      }
      case FtpOp.TerminateSession:
        return reply(FtpOp.Ack)
    }
  }, 50) // short timeout so the retry test is fast
  return client
}

afterEach(() => vi.useRealTimers())

describe('MavFtpClient', () => {
  it('reads a whole file in fixed chunks', async () => {
    const file = new Uint8Array(600).map((_, i) => i & 0xff)
    const client = scriptedDevice(file)
    const progress: number[] = []
    const out = await client.readFile('@PARAM/param.pck', (got) => progress.push(got))
    expect(out).toEqual(file)
    expect(progress.at(-1)).toBe(600)
  })

  it('retries a lost read and still completes', async () => {
    const file = new Uint8Array(300).map((_, i) => (i * 7) & 0xff)
    const client = scriptedDevice(file, { dropFirstRead: true })
    const out = await client.readFile('x')
    expect(out).toEqual(file)
  })

  it('times out cleanly when the device never answers', async () => {
    const client = new MavFtpClient(() => {}, 10)
    await expect(client.readFile('x')).rejects.toThrow(/timed out/)
  })
})
