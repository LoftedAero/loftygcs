// MAVFTP client: request/response over FILE_TRANSFER_PROTOCOL with per-op
// timeout and retry, following pymavlink mavftp.py's semantics. Reads are
// sequential for now -- ample for USB/TCP links; the pipelined burst-read
// optimization for lossy radio links is roadmap and slots in behind the same
// readFile() surface.
//
// One rule worth its comment (from ArduPilot's @PARAM docs): all reads on a
// file handle must use the SAME size, or a re-read after a lost packet can
// split a parameter record across block boundaries on the device side.
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
    // The name is in the message, not just the number: this error crosses
    // the worker boundary as a plain Error, so the message is all a caller
    // on the other side has left to reason about.
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
 * size after a tab. Nulls in the payload are the separators, and a trailing
 * one is normal -- so empty pieces are dropped rather than counted.
 *
 * Skipped entries come back as null: they occupy a slot in the index the
 * next request has to account for, but they are not directory contents.
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

export class MavFtpClient {
  private seq = 0
  private pending = new Map<number, Pending>()
  /** Set while a burst read is running; see burstOnce. */
  private burst: { onPacket: (p: FtpPacket) => void } | null = null

  constructor(
    private sendPayload: (payload: number[]) => void,
    private opTimeoutMs = OP_TIMEOUT_MS,
  ) {}

  /** Feed every incoming FILE_TRANSFER_PROTOCOL payload here. */
  handlePayload(payload: number[] | Uint8Array) {
    const pkt = decodeFtpPacket(payload)

    // A burst is one request answered by many packets, so only the first
    // matches a pending seq and the rest would be dropped as stale. They
    // are identified by what they are a reply *to*, not by their sequence.
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
   * The offset field is an *entry index*, not a byte offset -- the one part
   * of this opcode that does not work like the others -- so paging means
   * counting the entries already seen rather than the bytes. The device
   * ends the listing by NAKing with EndOfFile, which is a normal reply and
   * not a failure.
   */
  async listDirectory(path: string): Promise<FtpDirEntry[]> {
    const out: FtpDirEntry[] = []
    let index = 0
    for (;;) {
      let reply
      try {
        reply = await this.request(
          FtpOp.ListDirectory,
          0,
          index,
          new TextEncoder().encode(path),
        )
      } catch (err) {
        if (err instanceof FtpNak && err.code === FtpError.EndOfFile) break
        throw err
      }
      const entries = parseDirEntries(reply.data)
      if (entries.length === 0) break
      for (const e of entries) if (e) out.push(e)
      index += entries.length
      // A directory with more entries than anyone wants to page through is
      // a sign something is wrong; stop rather than loop forever.
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
  async readChunk(session: number, offset: number, size = FTP_MAX_DATA): Promise<Uint8Array | null> {
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
   * A plain read is a round trip per 239 bytes, which measured at 28 ms
   * against SITL -- eight kilobytes a second, or twenty-four minutes for a
   * ten-megabyte log. ArduPilot answers a burst request with a stream of
   * packets instead, which is the difference between this feature working
   * and not. Pipelining ordinary reads does not help: the vehicle serves
   * one FTP request at a time and simply times the rest out.
   *
   * Returns the offset one past the last contiguous byte received. Bursts
   * are re-requested from there, so a dropped packet costs a little
   * re-reading rather than a hole in the file.
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
      // Idle timeout rather than a total one: a burst of a whole file is
      // legitimately long, but a gap between packets means it died.
      const arm = () => {
        clearTimeout(timer)
        timer = setTimeout(() => finish(() => resolve(end)), this.opTimeoutMs * 4)
      }

      this.burst = {
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
      // Sent directly rather than through request(): every reply belongs to
      // the burst handler, including the first, which would otherwise be
      // consumed as an ordinary answer and never reach it.
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

  async terminate(session: number): Promise<void> {
    try {
      await this.request(FtpOp.TerminateSession, session, 0)
    } catch {
      // A session the device already dropped is fine -- we wanted it gone.
    }
  }

  /**
   * Read a whole file, by burst where the vehicle supports it.
   *
   * The fallback is the same shape as the parameter download's: try the
   * fast path, and drop to the one that always works rather than failing.
   * Firmware old enough to lack BurstReadFile answers UnknownCommand, and
   * some links lose enough packets that a burst never completes.
   */
  async readFile(
    path: string,
    onProgress?: (got: number, total: number) => void,
  ): Promise<Uint8Array> {
    await this.resetSessions()
    const { session, size } = await this.openFileRO(path)
    if (size > 0) {
      try {
        const out = new Uint8Array(size)
        let at = 0
        let stalled = 0
        while (at < size) {
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
      } catch {
        // Fall through to the sequential path on the same open session.
      }
    }
    const chunks: Uint8Array[] = []
    let offset = 0
    try {
      for (;;) {
        const chunk = await this.readChunk(session, offset)
        if (chunk === null) break
        chunks.push(chunk)
        offset += chunk.length
        onProgress?.(offset, size)
        // A short chunk before the reported size can just mean the device
        // capped one read; only EOF (null) ends the loop. But a zero-length
        // chunk would loop forever -- treat it as EOF.
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
