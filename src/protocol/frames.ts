// MAVLink v1/v2 wire framing: a resync state machine over raw bytes, and the
// outbound frame builder. Field-level (de)serialization lives in
// serializer.ts; this file only knows about headers, CRCs, and boundaries.
//
// Wire layout (all little-endian):
//   v2: FD len incompat compat seq sysid compid msgid[3] payload crc[2] [sig 13]
//   v1: FE len seq sysid compid msgid payload crc[2]
// The CRC is X.25 over everything after the magic byte, with the message's
// CRC_EXTRA ("magic number") digested last -- so an unknown msgid cannot be
// CRC-checked at all and must be dropped, not trusted.
import { x25crc } from 'mavlink-mappings'
import { messageById, messageByName, encodePayload } from './serializer'
import type { FieldValue, MavFrame } from './types'

const MAGIC_V2 = 0xfd
const MAGIC_V1 = 0xfe
const INCOMPAT_SIGNED = 0x01
const SIGNATURE_LENGTH = 13

export interface FramerStats {
  frames: number
  droppedBytes: number
  badFrames: number
}

export class MavFramer {
  private buf: Uint8Array = new Uint8Array(0)
  readonly stats: FramerStats = { frames: 0, droppedBytes: 0, badFrames: 0 }

  /** Feed raw bytes; returns every complete, CRC-valid frame found. */
  push(bytes: Uint8Array): MavFrame[] {
    if (this.buf.length === 0) {
      this.buf = bytes
    } else {
      const merged = new Uint8Array(this.buf.length + bytes.length)
      merged.set(this.buf)
      merged.set(bytes, this.buf.length)
      this.buf = merged
    }

    const frames: MavFrame[] = []
    let pos = 0
    while (pos < this.buf.length) {
      const magic = this.buf[pos]
      if (magic !== MAGIC_V2 && magic !== MAGIC_V1) {
        pos++
        this.stats.droppedBytes++
        continue
      }
      const parsed = this.tryParseAt(pos)
      if (parsed === 'incomplete') break
      if (parsed === 'invalid') {
        // A magic byte that did not pan out is just payload data that happened
        // to look like one -- advance a single byte and keep hunting.
        pos++
        this.stats.droppedBytes++
        this.stats.badFrames++
        continue
      }
      frames.push(parsed.frame)
      this.stats.frames++
      pos += parsed.size
    }
    this.buf = this.buf.subarray(pos)
    return frames
  }

  private tryParseAt(pos: number): { frame: MavFrame; size: number } | 'incomplete' | 'invalid' {
    const b = this.buf
    const isV2 = b[pos] === MAGIC_V2
    const headerLen = isV2 ? 10 : 6
    if (pos + headerLen > b.length) return 'incomplete'
    const len = b[pos + 1]!
    const signed = isV2 && (b[pos + 2]! & INCOMPAT_SIGNED) !== 0
    const size = headerLen + len + 2 + (signed ? SIGNATURE_LENGTH : 0)
    if (pos + size > b.length) return 'incomplete'

    let seq: number, sysid: number, compid: number, msgid: number
    if (isV2) {
      seq = b[pos + 4]!
      sysid = b[pos + 5]!
      compid = b[pos + 6]!
      msgid = b[pos + 7]! | (b[pos + 8]! << 8) | (b[pos + 9]! << 16)
    } else {
      seq = b[pos + 2]!
      sysid = b[pos + 3]!
      compid = b[pos + 4]!
      msgid = b[pos + 5]!
    }

    const cls = messageById(msgid)
    if (!cls) return 'invalid'

    const crcRegion = b.subarray(pos, pos + headerLen + len + 2)
    // x25crc's signature says Buffer but it only indexes -- any Uint8Array works.
    const computed = x25crc(crcRegion as unknown as Buffer, 1, 2, cls.MAGIC_NUMBER)
    const received = b[pos + headerLen + len]! | (b[pos + headerLen + len + 1]! << 8)
    if (computed !== received) return 'invalid'

    return {
      frame: {
        version: isV2 ? 2 : 1,
        seq,
        sysid,
        compid,
        msgid,
        // Copy out of the scratch buffer: the frame outlives this.buf.
        payload: b.slice(pos + headerLen, pos + headerLen + len),
        signed,
      },
      size,
    }
  }
}

/** Build a MAVLink v2 frame (unsigned; signing arrives with the signing UI). */
export function encodeFrame(
  msgName: string,
  fields: Record<string, FieldValue>,
  seq: number,
  sysid: number,
  compid: number,
): Uint8Array {
  const cls = messageByName(msgName)
  if (!cls) throw new Error(`unknown MAVLink message ${msgName}`)
  const payload = encodePayload(cls, fields)

  // v2 truncates trailing zeros, to a minimum payload of one byte.
  let len = payload.length
  while (len > 1 && payload[len - 1] === 0) len--

  const frame = new Uint8Array(10 + len + 2)
  frame[0] = MAGIC_V2
  frame[1] = len
  frame[2] = 0 // incompat: unsigned
  frame[3] = 0 // compat
  frame[4] = seq & 0xff
  frame[5] = sysid
  frame[6] = compid
  frame[7] = cls.MSG_ID & 0xff
  frame[8] = (cls.MSG_ID >> 8) & 0xff
  frame[9] = (cls.MSG_ID >> 16) & 0xff
  frame.set(payload.subarray(0, len), 10)
  const crc = x25crc(frame as unknown as Buffer, 1, 2, cls.MAGIC_NUMBER)
  frame[10 + len] = crc & 0xff
  frame[11 + len] = (crc >> 8) & 0xff
  return frame
}
