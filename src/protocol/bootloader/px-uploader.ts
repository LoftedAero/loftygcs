// ArduPilot/PX4 serial bootloader client, ported from px_uploader.py's
// protocol (GPL-3.0); Mission Planner's px4uploader uses the same flow. It is
// a plain byte protocol over the CDC port, so it works over Web Serial.
//
// Callers must identify the board and match its board_id against the
// firmware before erasing anything, so a wrong-board refusal costs nothing.

const INSYNC = 0x12
const EOC = 0x20
const OK = 0x10
const FAILED = 0x11
const INVALID = 0x13
const BAD_SILICON_REV = 0x14

const GET_SYNC = 0x21
const GET_DEVICE = 0x22
const CHIP_ERASE = 0x23
const PROG_MULTI = 0x27
const GET_CRC = 0x29
const REBOOT = 0x30

const DEVICE_BL_REV = 1
const DEVICE_BOARD_ID = 2
const DEVICE_BOARD_REV = 3
const DEVICE_FW_SIZE = 4

const PROG_MULTI_MAX = 252 // must stay a multiple of 4
const ERASE_TIMEOUT_MS = 60000 // big-flash boards erase slowly
const REPLY_TIMEOUT_MS = 2000

/**
 * px_uploader.py's CRC accumulator: the standard reflected CRC-32 table,
 * but with init 0 and no final complement, matching what the bootloader
 * computes over its whole flash (erased bytes read 0xff).
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function bootloaderCrc32(bytes: Uint8Array, state = 0): number {
  for (let i = 0; i < bytes.length; i++) {
    state = (CRC_TABLE[(state ^ bytes[i]!) & 0xff]! ^ (state >>> 8)) >>> 0
  }
  return state >>> 0
}

/** What the uploader needs from a serial link. */
export interface ByteLink {
  write(bytes: Uint8Array): void
  /** Resolve with at least one byte, or null on timeout. */
  read(timeoutMs: number): Promise<Uint8Array | null>
}

/** A pull-based byte queue to adapt event-style transports to ByteLink. */
export class ByteQueue implements ByteLink {
  private chunks: Uint8Array[] = []
  private waiter: ((chunk: Uint8Array | null) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private writeFn: (bytes: Uint8Array) => void) {}

  write(bytes: Uint8Array) {
    this.writeFn(bytes)
  }

  push(bytes: Uint8Array) {
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      if (this.timer) clearTimeout(this.timer)
      w(bytes)
    } else {
      this.chunks.push(bytes)
    }
  }

  read(timeoutMs: number): Promise<Uint8Array | null> {
    const chunk = this.chunks.shift()
    if (chunk) return Promise.resolve(chunk)
    return new Promise((resolve) => {
      this.waiter = resolve
      this.timer = setTimeout(() => {
        this.waiter = null
        resolve(null)
      }, timeoutMs)
    })
  }
}

export interface BootloaderInfo {
  blRev: number
  boardId: number
  boardRev: number
  fwSize: number
}

export type FlashPhase = 'sync' | 'erase' | 'program' | 'verify' | 'reboot'

export interface FlashCallbacks {
  onPhase?: (phase: FlashPhase) => void
  onProgress?: (pct: number) => void
  onLog?: (line: string) => void
}

export class PxUploader {
  private pending = new Uint8Array(0)

  constructor(
    private link: ByteLink,
    private cb: FlashCallbacks = {},
  ) {}

  private async readBytes(n: number, timeoutMs: number): Promise<Uint8Array> {
    while (this.pending.length < n) {
      const chunk = await this.link.read(timeoutMs)
      if (!chunk) throw new Error('bootloader: timed out waiting for reply')
      const merged = new Uint8Array(this.pending.length + chunk.length)
      merged.set(this.pending)
      merged.set(chunk, this.pending.length)
      this.pending = merged
    }
    const out = this.pending.slice(0, n)
    this.pending = this.pending.slice(n)
    return out
  }

  private async expectSync(timeoutMs = REPLY_TIMEOUT_MS) {
    const reply = await this.readBytes(2, timeoutMs)
    if (reply[0] !== INSYNC)
      throw new Error(`bootloader: lost sync (got 0x${reply[0]!.toString(16)})`)
    switch (reply[1]) {
      case OK:
        return
      case INVALID:
        throw new Error('bootloader: invalid command')
      case FAILED:
        throw new Error('bootloader: operation failed')
      case BAD_SILICON_REV:
        throw new Error('bootloader: board silicon revision cannot run this firmware')
      default:
        throw new Error(`bootloader: unexpected status 0x${reply[1]!.toString(16)}`)
    }
  }

  /** Establish sync; the bootloader may be mid-banner, so retry. */
  async sync(attempts = 10): Promise<void> {
    this.cb.onPhase?.('sync')
    for (let i = 0; i < attempts; i++) {
      this.pending = new Uint8Array(0)
      this.link.write(new Uint8Array([GET_SYNC, EOC]))
      try {
        await this.expectSync(500)
        return
      } catch {
        // keep knocking
      }
    }
    throw new Error('bootloader: no response. Is the board in bootloader mode on this port?')
  }

  private async getDeviceWord(param: number): Promise<number> {
    this.link.write(new Uint8Array([GET_DEVICE, param, EOC]))
    const raw = await this.readBytes(4, REPLY_TIMEOUT_MS)
    await this.expectSync()
    return new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true)
  }

  async identify(): Promise<BootloaderInfo> {
    const blRev = await this.getDeviceWord(DEVICE_BL_REV)
    const boardId = await this.getDeviceWord(DEVICE_BOARD_ID)
    const boardRev = await this.getDeviceWord(DEVICE_BOARD_REV)
    const fwSize = await this.getDeviceWord(DEVICE_FW_SIZE)
    this.cb.onLog?.(`bootloader rev ${blRev}, board id ${boardId}, flash ${fwSize} bytes`)
    return { blRev, boardId, boardRev, fwSize }
  }

  async erase(): Promise<void> {
    this.cb.onPhase?.('erase')
    this.cb.onLog?.('erasing (this can take up to a minute)…')
    this.link.write(new Uint8Array([CHIP_ERASE, EOC]))
    await this.expectSync(ERASE_TIMEOUT_MS)
  }

  async program(image: Uint8Array): Promise<void> {
    this.cb.onPhase?.('program')
    // Pad to a 4-byte boundary; flash writes are word-granular.
    let padded = image
    if (image.length % 4 !== 0) {
      padded = new Uint8Array(image.length + (4 - (image.length % 4)))
      padded.fill(0xff)
      padded.set(image)
    }
    for (let offset = 0; offset < padded.length; offset += PROG_MULTI_MAX) {
      const chunk = padded.subarray(offset, Math.min(offset + PROG_MULTI_MAX, padded.length))
      const frame = new Uint8Array(3 + chunk.length)
      frame[0] = PROG_MULTI
      frame[1] = chunk.length
      frame.set(chunk, 2)
      frame[frame.length - 1] = EOC
      this.link.write(frame)
      await this.expectSync()
      this.cb.onProgress?.(Math.round((100 * (offset + chunk.length)) / padded.length))
    }
  }

  async verify(image: Uint8Array, fwSize: number): Promise<void> {
    this.cb.onPhase?.('verify')
    this.link.write(new Uint8Array([GET_CRC, EOC]))
    const raw = await this.readBytes(4, ERASE_TIMEOUT_MS) // CRC of big flash takes a while
    await this.expectSync()
    const reported = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true)
    // The board CRCs its whole program flash; erased bytes read 0xff.
    let expected = bootloaderCrc32(image)
    const pad = new Uint8Array(1024).fill(0xff)
    let remaining = fwSize - image.length
    // Word padding the programmer added is 0xff too, so it folds in here.
    while (remaining > 0) {
      expected = bootloaderCrc32(pad.subarray(0, Math.min(1024, remaining)), expected)
      remaining -= 1024
    }
    if (reported !== expected) {
      throw new Error(
        `verify FAILED: board reports crc 0x${reported.toString(16)}, expected 0x${expected.toString(16)}. Do not fly; flash again.`,
      )
    }
    this.cb.onLog?.('CRC verified.')
  }

  reboot() {
    this.cb.onPhase?.('reboot')
    // No reply expected; the port is about to vanish.
    this.link.write(new Uint8Array([REBOOT, EOC]))
  }
}
