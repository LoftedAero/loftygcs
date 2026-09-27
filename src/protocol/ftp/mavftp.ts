// MAVFTP client: request/response over FILE_TRANSFER_PROTOCOL with per-op
// timeout and retry, following pymavlink mavftp.py's semantics.
//
// From ArduPilot's @PARAM docs: all reads on a file handle must use the same
// size, or a re-read after a lost packet can split a parameter record across
// block boundaries on the device side.
import {
  FTP_MAX_DATA,
  FtpError,
  FtpOp,
  decodeFtpPacket,
  encodeFtpPacket,
  type FtpPacket,
} from './packet'

const OP_TIMEOUT_MS = 1000
const OP_RETRIES = 3

/** Names for the NAK codes, so an error says something on its own. */
const FTP_ERROR_NAMES: Record<number, string> = {
  1: 'Fail',
  2: 'FailErrno',
  3: 'InvalidDataSize',
  4: 'InvalidSession',
  5: 'NoSessionsAvailable',
  6: 'EndOfFile',
  7: 'UnknownCommand',
  8: 'FileExists',
  9: 'FileProtected',
  10: 'FileNotFound',
}

export class FtpNak extends Error {
  constructor(readonly code: number) {
    // The name goes in the message because this crosses the worker boundary
    // as a plain Error.
    super(`MAVFTP NAK ${FTP_ERROR_NAMES[code] ?? 'error'} (${code})`)
  }
}

interface Pending {
  resolve: (p: FtpPacket) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One entry from a ListDirectory reply. */
export interface FtpDirEntry {
  name: string
  kind: 'file' | 'directory'
  /** Bytes, for files that reported a size. */
  size?: number
}

/** Refuse to page a directory forever if a device keeps answering. */
const MAX_DIR_ENTRIES = 5000

/**
 * Split a ListDirectory payload into entries.
 *
 * Each entry is a NUL-terminated string whose first character is its kind:
 * 'F' a file, 'D' a directory, 'S' an entry to skip. A file carries its
 * size after a tab. A trailing NUL is normal, so empty pieces are dropped.
 *
 * Skipped entries come back as null: they still occupy a slot in the index
 * the next request has to account for.
 */
export function parseDirEntries(data: Uint8Array): (FtpDirEntry | null)[] {
  const text = new TextDecoder().decode(data)
  const out: (FtpDirEntry | null)[] = []
  for (const piece of text.split('\0')) {
    if (piece.length === 0) continue
    const kind = piece[0]
    const rest = piece.slice(1)
    if (kind === 'S') {
      out.push(null)
      continue
    }
    if (kind === 'D') {
      out.push({ name: rest, kind: 'directory' })
      continue
    }
    if (kind !== 'F') continue
    const tab = rest.lastIndexOf('\t')
    if (tab < 0) {
      out.push({ name: rest, kind: 'file' })
      continue
    }
    const size = Number(rest.slice(tab + 1))
    out.push({
      name: rest.slice(0, tab),
      kind: 'file',
      ...(Number.isFinite(size) ? { size } : {}),
    })
  }
  return out
}

/** A read stopped by `cancelRead`, told apart from a failure by its name. */
export class FtpCancelled extends Error {
  constructor() {
    super('transfer canceled')
    this.name = 'FtpCancelled'
  }
}

export class MavFtpClient {
  private seq = 0
  private pending = new Map<number, Pending>()
  /** Set while a burst read is running; see burstOnce. */
  private burst: { onPacket: (p: FtpPacket) => void; cancel: () => void } | null = null
  /** Set by `cancelRead` and seen by the read in progress; cleared by the next. */
  private readCancelled = false

  constructor(
    private sendPayload: (payload: number[]) => void,
    private opTimeoutMs = OP_TIMEOUT_MS,
  ) {}

  /** Feed every incoming FILE_TRANSFER_PROTOCOL payload here. */
  handlePayload(payload: number[] | Uint8Array) {
    const pkt = decodeFtpPacket(payload)

    // A burst is one request answered by many packets, so only the first
    // matches a pending seq. Route them by the opcode they answer instead.
    if (this.burst && pkt.reqOpcode === FtpOp.BurstReadFile) {
      this.burst.onPacket(pkt)
      return
    }

    // Replies carry seq+1 of the request they answer.
    const want = (pkt.seq - 1) & 0xffff
    const p = this.pending.get(want)
    if (!p) return // late duplicate after a retry already resolved
    this.pending.delete(want)
    clearTimeout(p.timer)
    if (pkt.opcode === FtpOp.Nak) {
      p.reject(new FtpNak(pkt.data[0] ?? FtpError.Fail))
    } else {
      p.resolve(pkt)
    }
  }

  /**
   * Stop the file read in progress.
   *
   * The read rejects with `FtpCancelled` and ends its session on the vehicle,
   * which is what stops a burst. It does not fall back to sequential reads.
   * Other requests in flight are left alone.
   */
  cancelRead() {
    this.readCancelled = true
    this.burst?.cancel()
  }

  /** Abandon everything in flight (link closed, probe abandoned). */
  abort(reason: string) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private request(
    opcode: number,
    session: number,
    offset: number,
    data?: Uint8Array,
    size?: number,
  ): Promise<FtpPacket> {
    const attempt = (retriesLeft: number): Promise<FtpPacket> => {
      const seq = this.seq++ & 0xffff
      const payload = encodeFtpPacket({
        seq,
        session,
        opcode,
        offset,
        ...(data ? { data } : {}),
        ...(size !== undefined ? { size } : {}),
      })
      return new Promise<FtpPacket>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(seq)
          if (retriesLeft > 0) {
            attempt(retriesLeft - 1).then(resolve, reject)
          } else {
            reject(new Error(`MAVFTP op ${opcode} timed out`))
          }
        }, this.opTimeoutMs)
        this.pending.set(seq, { resolve, reject, timer })
        this.sendPayload(payload)
      })
    }
    return attempt(OP_RETRIES)
  }

  /**
   * List a directory.
   *
   * The offset field is an entry index, not a byte offset. The device ends
   * the listing with an EndOfFile NAK, which is not a failure.
   */
  async listDirectory(path: string): Promise<FtpDirEntry[]> {
    const out: FtpDirEntry[] = []
    let index = 0
    for (;;) {
      let reply
      try {
        reply = await this.request(FtpOp.ListDirectory, 0, index, new TextEncoder().encode(path))
      } catch (err) {
        if (err instanceof FtpNak && err.code === FtpError.EndOfFile) break
        throw err
      }
      const entries = parseDirEntries(reply.data)
      if (entries.length === 0) break
      for (const e of entries) if (e) out.push(e)
      index += entries.length
      // Stop rather than page forever through a device that never ends.
      if (out.length > MAX_DIR_ENTRIES) break
    }
    return out
  }

  async resetSessions(): Promise<void> {
    await this.request(FtpOp.ResetSessions, 0, 0)
  }

  /** Returns the session id and file size. */
  async openFileRO(path: string): Promise<{ session: number; size: number }> {
    const reply = await this.request(FtpOp.OpenFileRO, 0, 0, new TextEncoder().encode(path))
    const view = new DataView(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength)
    return { session: reply.session, size: view.getUint32(0, true) }
  }

  /** Read one chunk; null means EOF. Always call with the same chunk size. */
  async readChunk(
    session: number,
    offset: number,
    size = FTP_MAX_DATA,
  ): Promise<Uint8Array | null> {
    try {
      // The byte count rides in the header's size field; data stays empty.
      const reply = await this.request(FtpOp.ReadFile, session, offset, undefined, size)
      return reply.data
    } catch (err) {
      if (err instanceof FtpNak && err.code === FtpError.EndOfFile) return null
      throw err
    }
  }

  /**
   * One burst: ask once, receive many.
   *
   * A plain read is a round trip per 239 bytes (about 8 kB/s against SITL).
   * ArduPilot answers a burst request with a stream of packets instead.
   * Pipelining ordinary reads does not work: the vehicle serves one FTP
   * request at a time and times the rest out.
   *
   * Returns the offset one past the last contiguous byte received. The next
   * burst starts there, so a dropped packet never leaves a hole.
   */
  private burstOnce(
    session: number,
    offset: number,
    into: Uint8Array,
    onChunk: (end: number) => void,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      let end = offset
      let timer: ReturnType<typeof setTimeout>
      const finish = (fn: () => void) => {
        clearTimeout(timer)
        this.burst = null
        fn()
      }
      // Idle timeout rather than a total one: a whole-file burst is long, but
      // a gap between packets means it died.
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(() => resolve(end)), this.opTimeoutMs * 4)
      }

      this.burst = {
        cancel: () => finish(() => reject(new FtpCancelled())),
        onPacket: (pkt) => {
          if (pkt.opcode === FtpOp.Nak) {
            const code = pkt.data[0] ?? FtpError.Fail
            // EndOfFile ends a burst normally; anything else is a failure.
            if (code === FtpError.EndOfFile) finish(() => resolve(end))
            else finish(() => reject(new FtpNak(code)))
            return
          }
          // Out-of-order or duplicate data: keep only what extends the
          // contiguous run, and let the next burst re-request the rest.
          if (pkt.offset <= end && pkt.data.length > 0) {
            const at = pkt.offset
            const room = Math.min(pkt.data.length, into.length - at)
            if (room > 0) {
              into.set(pkt.data.subarray(0, room), at)
              if (at + room > end) {
                end = at + room
                onChunk(end)
              }
            }
          }
          if (pkt.burstComplete) finish(() => resolve(end))
          else arm()
        },
      }
      arm()
      // Sent directly rather than through request(), which would consume the
      // first reply as an ordinary answer.
      this.sendPayload(
        encodeFtpPacket({
          seq: this.seq++ & 0xffff,
          session,
          opcode: FtpOp.BurstReadFile,
          offset,
          size: FTP_MAX_DATA,
        }),
      )
    })
  }

  /** Create (or truncate) a file for writing. Returns the session id. */
  async createFile(path: string): Promise<number> {
    const reply = await this.request(FtpOp.CreateFile, 0, 0, new TextEncoder().encode(path))
    return reply.session
  }

  /** Write one chunk at an absolute offset. */
  async writeChunk(session: number, offset: number, data: Uint8Array): Promise<void> {
    await this.request(FtpOp.WriteFile, session, offset, data)
  }

  /**
   * Write a whole file, one chunk at a time.
   *
   * There is no burst write, and pipelining does not work, so this is 239
   * bytes per round trip. Fine for scripts and fonts, too slow for more.
   */
  async writeFile(
    path: string,
    bytes: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    await this.resetSessions()
    const session = await this.createFile(path)
    try {
      for (let at = 0; at < bytes.length; at += FTP_MAX_DATA) {
        await this.writeChunk(session, at, bytes.subarray(at, at + FTP_MAX_DATA))
        onProgress?.(Math.min(at + FTP_MAX_DATA, bytes.length), bytes.length)
      }
      // An empty file still has to be created, which CreateFile already did.
      if (bytes.length === 0) onProgress?.(0, 0)
    } finally {
      await this.terminate(session)
    }
  }

  async removeFile(path: string): Promise<void> {
    await this.request(FtpOp.RemoveFile, 0, 0, new TextEncoder().encode(path))
  }

  async createDirectory(path: string): Promise<void> {
    await this.request(FtpOp.CreateDirectory, 0, 0, new TextEncoder().encode(path))
  }

  async removeDirectory(path: string): Promise<void> {
    await this.request(FtpOp.RemoveDirectory, 0, 0, new TextEncoder().encode(path))
  }

  /** Rename or move. The two paths travel in one payload, null separated. */
  async rename(from: string, to: string): Promise<void> {
    const encoder = new TextEncoder()
    const a = encoder.encode(from)
    const b = encoder.encode(to)
    const data = new Uint8Array(a.length + 1 + b.length)
    data.set(a, 0)
    data[a.length] = 0
    data.set(b, a.length + 1)
    await this.request(FtpOp.Rename, 0, 0, data)
  }

  async terminate(session: number): Promise<void> {
    try {
      await this.request(FtpOp.TerminateSession, session, 0)
    } catch {
      // A session the device already dropped is fine.
    }
  }

  /**
   * Read a whole file, by burst where the vehicle supports it.
   *
   * Falls back to sequential reads: firmware without BurstReadFile answers
   * UnknownCommand, and some links lose enough packets that a burst never
   * completes.
   */
  async readFile(
    path: string,
    onProgress?: (got: number, total: number) => void,
  ): Promise<Uint8Array> {
    this.readCancelled = false
    const stopIfCancelled = () => {
      if (this.readCancelled) throw new FtpCancelled()
    }
    await this.resetSessions()
    stopIfCancelled()
    const { session, size } = await this.openFileRO(path)
    // Cancel returns immediately and terminates the session in the
    // background: ArduPilot serves one FTP request at a time, so the
    // terminate ack only arrives after the burst already in flight.
    const closeAndStop = (err: unknown): never => {
      void this.terminate(session)
      throw err
    }
    try {
      stopIfCancelled()
    } catch (err) {
      closeAndStop(err)
    }
    if (size > 0) {
      try {
        const out = new Uint8Array(size)
        let at = 0
        let stalled = 0
        while (at < size) {
          stopIfCancelled()
          const end = await this.burstOnce(session, at, out, (got) => onProgress?.(got, size))
          if (end <= at) {
            // No progress at all: two in a row means bursts are not
            // getting through, and sequential reads are the answer.
            if (++stalled >= 2) throw new Error('burst read made no progress')
          } else {
            stalled = 0
          }
          at = Math.max(at, end)
        }
        await this.terminate(session)
        return out
      } catch (err) {
        // A cancel ends the read here; anything else falls through to the
        // sequential path on the same open session.
        if (err instanceof FtpCancelled) closeAndStop(err)
      }
    }
    const chunks: Uint8Array[] = []
    let offset = 0
    try {
      for (;;) {
        stopIfCancelled()
        const chunk = await this.readChunk(session, offset)
        if (chunk === null) break
        chunks.push(chunk)
        offset += chunk.length
        onProgress?.(offset, size)
        // A short chunk can just mean the device capped one read, so only EOF
        // (null) ends the loop. A zero-length chunk is treated as EOF.
        if (chunk.length === 0) break
      }
    } finally {
      await this.terminate(session)
    }
    const out = new Uint8Array(offset)
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}
