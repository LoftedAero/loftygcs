import { describe, expect, it, vi, afterEach } from 'vitest'
import { FtpCancelled, MavFtpClient, parseDirEntries } from './mavftp'
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
          encodeFtpPacket({
            seq: (req.seq + 1) & 0xffff,
            session,
            opcode,
            offset: req.offset,
            ...(data ? { data } : {}),
          }),
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
 * `mode` picks the misbehavior to test against.
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

describe('canceling a read', () => {
  const file = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff)

  it('stops a burst, ends the session, and does not fall back to plain reads', async () => {
    // Silent, so the burst is still waiting when the cancel lands.
    const { client, saw } = burstDevice(file, 'silent')
    const read = client.readFile('/logs/1.BIN')
    await vi.waitFor(() => expect(saw).toContain(FtpOp.BurstReadFile))
    client.cancelRead()
    await expect(read).rejects.toBeInstanceOf(FtpCancelled)
    // The session is closed so the vehicle stops sending, and the slow path a
    // failed burst would take is not taken for a file nobody wants.
    expect(saw.slice(saw.indexOf(FtpOp.BurstReadFile))).toContain(FtpOp.TerminateSession)
    expect(saw).not.toContain(FtpOp.ReadFile)
  })

  it('stops the plain-read path too, part way', async () => {
    const { client, saw } = burstDevice(file, 'unsupported')
    const read = client.readFile('/logs/1.BIN', (got) => {
      if (got > 0) client.cancelRead()
    })
    await expect(read).rejects.toBeInstanceOf(FtpCancelled)
    expect(saw.filter((op) => op === FtpOp.ReadFile).length).toBeLessThan(file.length / 239)
    expect(saw.at(-1)).toBe(FtpOp.TerminateSession)
  })

  it('does not carry over to the next read', async () => {
    const { client } = burstDevice(file, 'silent')
    const first = client.readFile('/logs/1.BIN')
    client.cancelRead()
    await expect(first).rejects.toBeInstanceOf(FtpCancelled)
    expect(await client.readFile('/logs/1.BIN')).toEqual(file)
  })
})

/**
 * A device that accepts writes, keeping what it is sent so the test can
 * compare it with what was meant. It also records the raw requests, which
 * is how the offsets and the rename payload get checked -- those are the
 * parts a receiving autopilot would notice and a mock would not.
 */
function writableDevice({ failAt = -1 } = {}) {
  const written = new Map<number, Uint8Array>()
  const seen: { opcode: number; offset: number; data: Uint8Array; session: number }[] = []
  let terminated = false
  const client: MavFtpClient = new MavFtpClient((payload) => {
    const req = decodeFtpPacket(payload)
    seen.push({ opcode: req.opcode, offset: req.offset, data: req.data, session: req.session })
    const reply = (opcode: number, data?: Uint8Array, session = req.session) =>
      queueMicrotask(() =>
        client.handlePayload(
          encodeFtpPacket({
            seq: (req.seq + 1) & 0xffff,
            session,
            opcode,
            offset: req.offset,
            ...(data ? { data } : {}),
          }),
        ),
      )
    switch (req.opcode) {
      case FtpOp.ResetSessions:
        return reply(FtpOp.Ack)
      case FtpOp.CreateFile:
        return reply(FtpOp.Ack, undefined, 3)
      case FtpOp.WriteFile:
        if (req.offset === failAt) {
          return reply(FtpOp.Nak, new Uint8Array([FtpError.FailErrno]))
        }
        written.set(req.offset, req.data.slice())
        return reply(FtpOp.Ack)
      case FtpOp.TerminateSession:
        terminated = true
        return reply(FtpOp.Ack)
      case FtpOp.RemoveFile:
      case FtpOp.CreateDirectory:
      case FtpOp.RemoveDirectory:
      case FtpOp.Rename:
        return reply(FtpOp.Ack)
    }
  }, 50)
  const assembled = () => {
    const offsets = [...written.keys()].sort((a, b) => a - b)
    const total = offsets.reduce((n, o) => n + written.get(o)!.length, 0)
    const out = new Uint8Array(total)
    for (const o of offsets) out.set(written.get(o)!, o)
    return out
  }
  return { client, seen, assembled, wasTerminated: () => terminated }
}

describe('writing a file to the vehicle', () => {
  it('arrives byte for byte', async () => {
    // Bigger than one chunk on purpose: 239 is the payload limit, and an
    // off-by-one in the chunking corrupts a Lua script silently.
    const file = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
    const dev = writableDevice()
    await dev.client.writeFile('/APM/scripts/test.lua', file)
    expect(dev.assembled()).toEqual(file)
  })

  it('writes at absolute offsets, in order', async () => {
    const dev = writableDevice()
    await dev.client.writeFile('/x', new Uint8Array(600))
    const writes = dev.seen.filter((r) => r.opcode === FtpOp.WriteFile)
    expect(writes.map((w) => w.offset)).toEqual([0, 239, 478])
    expect(writes.map((w) => w.data.length)).toEqual([239, 239, 122])
    // Every write goes to the session CreateFile handed back, not zero.
    expect(writes.every((w) => w.session === 3)).toBe(true)
  })

  it('reports progress ending at the file size', async () => {
    const dev = writableDevice()
    const progress: number[] = []
    await dev.client.writeFile('/x', new Uint8Array(500), (sent) => progress.push(sent))
    expect(progress.at(-1)).toBe(500)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  it('creates an empty file rather than sending nothing', async () => {
    const dev = writableDevice()
    await dev.client.writeFile('/empty.txt', new Uint8Array(0))
    expect(dev.seen.some((r) => r.opcode === FtpOp.CreateFile)).toBe(true)
    expect(dev.seen.some((r) => r.opcode === FtpOp.WriteFile)).toBe(false)
  })

  it('closes the session even when a write fails', async () => {
    // A session left open is one of the four the vehicle has; leaking them
    // makes the next transfer fail for a reason nobody can see.
    const dev = writableDevice({ failAt: 239 })
    await expect(dev.client.writeFile('/x', new Uint8Array(600))).rejects.toThrow()
    expect(dev.wasTerminated()).toBe(true)
  })
})

describe('the other filesystem operations', () => {
  const text = (d: Uint8Array) => new TextDecoder().decode(d)

  it('sends a rename as two paths in one payload', async () => {
    const dev = writableDevice()
    await dev.client.rename('/APM/a.lua', '/APM/b.lua')
    const req = dev.seen.find((r) => r.opcode === FtpOp.Rename)!
    expect(text(req.data)).toBe('/APM/a.lua\0/APM/b.lua')
  })

  it('sends the path for a delete, and uses the directory opcode for one', async () => {
    const dev = writableDevice()
    await dev.client.removeFile('/APM/a.lua')
    await dev.client.removeDirectory('/APM/old')
    await dev.client.createDirectory('/APM/new')
    expect(text(dev.seen.find((r) => r.opcode === FtpOp.RemoveFile)!.data)).toBe('/APM/a.lua')
    expect(text(dev.seen.find((r) => r.opcode === FtpOp.RemoveDirectory)!.data)).toBe('/APM/old')
    expect(text(dev.seen.find((r) => r.opcode === FtpOp.CreateDirectory)!.data)).toBe('/APM/new')
  })
})
