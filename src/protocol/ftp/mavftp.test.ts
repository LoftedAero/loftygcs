import { describe, expect, it, vi, afterEach } from 'vitest'
import { MavFtpClient, parseDirEntries } from './mavftp'
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

describe('reading a directory listing', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('reads files with their sizes and directories without', () => {
    const entries = parseDirEntries(bytes('F00000001.BIN\t7974912\0DAPM\0F00000002.BIN\t262144\0'))
    expect(entries).toEqual([
      { name: '00000001.BIN', kind: 'file', size: 7974912 },
      { name: 'APM', kind: 'directory' },
      { name: '00000002.BIN', kind: 'file', size: 262144 },
    ])
  })

  it('keeps a skipped entry as a hole, because the index counts it', () => {
    // 'S' entries occupy a slot the next request's offset has to account
    // for, but they are not directory contents. Dropping them silently
    // would make the listing re-read the same entries forever.
    const entries = parseDirEntries(bytes('Fa.BIN\t10\0S\0Fb.BIN\t20\0'))
    expect(entries).toHaveLength(3)
    expect(entries[1]).toBeNull()
  })

  it('survives a file entry with no size', () => {
    expect(parseDirEntries(bytes('Fodd.BIN\0'))).toEqual([{ name: 'odd.BIN', kind: 'file' }])
  })

  it('takes the last tab, so a name containing one still parses', () => {
    const entries = parseDirEntries(bytes('Fmy\tlog.BIN\t99\0'))
    expect(entries[0]).toEqual({ name: 'my\tlog.BIN', kind: 'file', size: 99 })
  })

  it('ignores the trailing separator rather than counting it', () => {
    // A trailing NUL is normal, and an empty entry would inflate the index
    // and skip a real file on the next page.
    expect(parseDirEntries(bytes('Fa.BIN\t1\0'))).toHaveLength(1)
    expect(parseDirEntries(bytes(''))).toEqual([])
  })

  it('drops an entry whose kind it does not recognize', () => {
    expect(parseDirEntries(bytes('Xmystery\0Fa.BIN\t1\0'))).toEqual([
      { name: 'a.BIN', kind: 'file', size: 1 },
    ])
  })
})

/**
 * A device that answers BurstReadFile the way ArduPilot does: one request,
 * a stream of packets, the last one flagged complete.
 *
 * `mode` picks the misbehaviour to test against.
 */
function burstDevice(
  file: Uint8Array,
  mode: 'good' | 'unsupported' | 'silent' | 'duplicates' | 'gap' = 'good',
) {
  // Which opcodes the device was actually asked for. Without this a burst
  // test passes just as happily through the sequential fallback, which is
  // exactly what happened before it existed.
  const saw: number[] = []
  let gapDropped = false
  const client: MavFtpClient = new MavFtpClient((payload) => {
    const req = decodeFtpPacket(payload)
    saw.push(req.opcode)
    let seq = (req.seq + 1) & 0xffff
    const send = (p: Parameters<typeof encodeFtpPacket>[0]) =>
      queueMicrotask(() => client.handlePayload(encodeFtpPacket({ ...p, seq: seq++ & 0xffff })))

    switch (req.opcode) {
      case FtpOp.ResetSessions:
      case FtpOp.TerminateSession:
        return send({ seq, session: req.session, opcode: FtpOp.Ack, offset: 0 })
      case FtpOp.OpenFileRO: {
        const size = new Uint8Array(4)
        new DataView(size.buffer).setUint32(0, file.length, true)
        return send({ seq, session: 1, opcode: FtpOp.Ack, offset: 0, data: size })
      }
      case FtpOp.BurstReadFile: {
        if (mode === 'silent') return
        if (mode === 'unsupported') {
          return send({
            seq,
            session: req.session,
            opcode: FtpOp.Nak,
            offset: 0,
            data: new Uint8Array([FtpError.UnknownCommand]),
            reqOpcode: FtpOp.BurstReadFile,
          })
        }
        const step = 64
        // 'gap' loses one packet mid-burst, exactly once. Everything after
        // it arrives ahead of the contiguous point and must be ignored --
        // writing it would leave a hole in the middle of the file that
        // nothing later fills.
        let dropAt = mode === 'gap' && !gapDropped ? req.offset + step * 2 : -1
        for (let at = req.offset; at < file.length; at += step) {
          const chunk = file.subarray(at, Math.min(at + step, file.length))
          const last = at + step >= file.length
          if (at === dropAt) {
            gapDropped = true
            dropAt = -1
            continue
          }
          send({
            seq,
            session: req.session,
            opcode: FtpOp.Ack,
            offset: at,
            data: chunk,
            reqOpcode: FtpOp.BurstReadFile,
            burstComplete: last ? 1 : 0,
          })
          // A link that repeats a packet must not corrupt the result.
          if (mode === 'duplicates' && at === req.offset) {
            send({
              seq,
              session: req.session,
              opcode: FtpOp.Ack,
              offset: at,
              data: chunk,
              reqOpcode: FtpOp.BurstReadFile,
            })
          }
        }
        return
      }
      case FtpOp.ReadFile: {
        if (req.offset >= file.length) {
          return send({
            seq,
            session: req.session,
            opcode: FtpOp.Nak,
            offset: req.offset,
            data: new Uint8Array([FtpError.EndOfFile]),
          })
        }
        return send({
          seq,
          session: req.session,
          opcode: FtpOp.Ack,
          offset: req.offset,
          data: file.subarray(req.offset, req.offset + req.size),
        })
      }
    }
  }, 30)
  return { client, saw }
}

describe('burst reads', () => {
  const file = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff)

  it('reads a whole file from a stream of packets', async () => {
    // A plain read costs a round trip per 239 bytes -- 28 ms of them
    // against SITL, which is twenty-four minutes for a ten-megabyte log.
    const { client, saw } = burstDevice(file, 'good')
    const out = await client.readFile('/logs/1.BIN')
    expect(out).toEqual(file)
    // The point of the test: it came by burst, and not one plain read was
    // needed to finish it.
    expect(saw).toContain(FtpOp.BurstReadFile)
    expect(saw).not.toContain(FtpOp.ReadFile)
  })

  it('reports progress as the burst arrives, not only at the end', async () => {
    const seen: number[] = []
    await burstDevice(file, 'good').client.readFile('/logs/1.BIN', (got) => seen.push(got))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[seen.length - 1]).toBe(file.length)
  })

  it('ignores a repeated packet instead of writing it twice', async () => {
    const { client, saw } = burstDevice(file, 'duplicates')
    const out = await client.readFile('/logs/1.BIN')
    expect(out).toEqual(file)
    expect(saw).not.toContain(FtpOp.ReadFile)
  })

  it('re-requests from the gap when a packet goes missing', async () => {
    // Everything after a lost packet arrives ahead of where the file has
    // been filled to. Accepting it would leave a hole that nothing later
    // fills, and the log would be quietly corrupt rather than obviously
    // broken -- the worst way for this to fail.
    const { client, saw } = burstDevice(file, 'gap')
    const out = await client.readFile('/logs/1.BIN')
    expect(out).toEqual(file)
    // It recovered by asking again, not by falling back.
    expect(saw.filter((op) => op === FtpOp.BurstReadFile).length).toBeGreaterThan(1)
    expect(saw).not.toContain(FtpOp.ReadFile)
  })

  it('falls back to plain reads when the firmware has no burst', async () => {
    // Old firmware NAKs UnknownCommand; the file still has to arrive.
    const { client, saw } = burstDevice(file, 'unsupported')
    const out = await client.readFile('/logs/1.BIN')
    expect(out).toEqual(file)
    // It tried the fast path first, then did it the slow way.
    expect(saw).toContain(FtpOp.BurstReadFile)
    expect(saw).toContain(FtpOp.ReadFile)
  })

  it('falls back when bursts are simply never answered', async () => {
    // A link that drops them wholesale, which is the case a NAK does not
    // cover and the one that would otherwise hang forever.
    const { client, saw } = burstDevice(file, 'silent')
    const out = await client.readFile('/logs/1.BIN')
    expect(out).toEqual(file)
    expect(saw).toContain(FtpOp.ReadFile)
  })
})
