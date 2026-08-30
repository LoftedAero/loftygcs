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

export class FtpNak extends Error {
  constructor(readonly code: number) {
    super(`MAVFTP NAK ${code}`)
  }
}

interface Pending {
  resolve: (p: FtpPacket) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class MavFtpClient {
  private seq = 0
  private pending = new Map<number, Pending>()

  constructor(
    private sendPayload: (payload: number[]) => void,
    private opTimeoutMs = OP_TIMEOUT_MS,
  ) {}

  /** Feed every incoming FILE_TRANSFER_PROTOCOL payload here. */
  handlePayload(payload: number[] | Uint8Array) {
    const pkt = decodeFtpPacket(payload)
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

  async terminate(session: number): Promise<void> {
    try {
      await this.request(FtpOp.TerminateSession, session, 0)
    } catch {
      // A session the device already dropped is fine -- we wanted it gone.
    }
  }

  /** Read a whole file with fixed-size sequential chunks. */
  async readFile(
    path: string,
    onProgress?: (got: number, total: number) => void,
  ): Promise<Uint8Array> {
    await this.resetSessions()
    const { session, size } = await this.openFileRO(path)
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
