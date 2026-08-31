// RTP and H.264 depayloading, per RFC 3550 and RFC 6184.
//
// The renderer decodes video, not this process: a decoded 1080p30 frame is
// 8 MB and 250 MB/s of them will not cross a process boundary, while the
// compressed bitstream that produced them is a few hundred KB/s and crosses
// it for nothing. So the job here is to turn RTP packets back into access
// units and hand those over; Chromium's own hardware decoder does the rest.
//
// Pure functions and one small state machine, kept apart from the sockets so
// the fiddly part -- reassembling a picture split across a dozen packets --
// can be tested without a camera.

export interface RtpPacket {
  payloadType: number
  sequence: number
  timestamp: number
  /** Set on the last packet of an access unit. */
  marker: boolean
  payload: Uint8Array
}

const RTP_HEADER = 12

/** Returns null for anything too short or not RTP version 2. */
export function parseRtp(buf: Uint8Array): RtpPacket | null {
  if (buf.length < RTP_HEADER) return null
  if ((buf[0]! >> 6) !== 2) return null
  const csrcCount = buf[0]! & 0x0f
  const hasExtension = (buf[0]! & 0x10) !== 0
  let offset = RTP_HEADER + csrcCount * 4
  if (buf.length < offset) return null
  if (hasExtension) {
    if (buf.length < offset + 4) return null
    // The extension header's length counts 32-bit words after itself.
    const words = (buf[offset + 2]! << 8) | buf[offset + 3]!
    offset += 4 + words * 4
    if (buf.length < offset) return null
  }
  let end = buf.length
  if ((buf[0]! & 0x20) !== 0) {
    // Padding: the final byte counts the padding bytes, itself included.
    const pad = buf[end - 1] ?? 0
    if (pad === 0 || pad > end - offset) return null
    end -= pad
  }
  if (end < offset) return null
  return {
    payloadType: buf[1]! & 0x7f,
    sequence: (buf[2]! << 8) | buf[3]!,
    timestamp: ((buf[4]! << 24) | (buf[5]! << 16) | (buf[6]! << 8) | buf[7]!) >>> 0,
    marker: (buf[1]! & 0x80) !== 0,
    payload: buf.subarray(offset, end),
  }
}

export const NAL_IDR = 5
export const NAL_SPS = 7
export const NAL_PPS = 8
export const NAL_AUD = 9

const PKT_STAP_A = 24
const PKT_FU_A = 28

export function nalType(nal: Uint8Array): number {
  return (nal[0] ?? 0) & 0x1f
}

/** Access unit: the NAL units belonging to one picture, plus what it is. */
export interface AccessUnit {
  /** Annex-B bytes: each NAL preceded by a 4-byte start code. */
  data: Uint8Array
  /** True when the picture can be decoded without any earlier one. */
  keyframe: boolean
  /** The RTP timestamp, at 90 kHz for H.264. */
  timestamp: number
}

/**
 * Turns a stream of RTP packets back into access units.
 *
 * Three packet shapes matter in practice: a whole NAL in one packet, a STAP-A
 * carrying several small ones (typically SPS and PPS together), and FU-A,
 * which splits a large one across many packets. The rest of RFC 6184 --
 * STAP-B, MTAP, FU-B -- is not produced by anything in the wild, and
 * silently dropping a packet type is better than emitting a NAL that decodes
 * to garbage.
 *
 * A dropped packet is detected by the sequence number and the picture being
 * assembled is thrown away: half a frame decodes into a smear that persists
 * until the next keyframe, which looks far more like a broken app than a
 * brief freeze does.
 */
export class H264Depayloader {
  private nals: Uint8Array[] = []
  private fragments: Uint8Array[] = []
  private fragmentHeader = 0
  private expectedSeq: number | null = null
  private currentTs: number | null = null
  /** Parameter sets, remembered so every keyframe can carry them. */
  private sps: Uint8Array | null = null
  private pps: Uint8Array | null = null

  /** Seeds the parameter sets from the SDP, before any packet arrives. */
  setParameterSets(sps: Uint8Array | null, pps: Uint8Array | null) {
    if (sps) this.sps = sps
    if (pps) this.pps = pps
  }

  parameterSets(): { sps: Uint8Array | null; pps: Uint8Array | null } {
    return { sps: this.sps, pps: this.pps }
  }

  /** Feed one packet; returns any access units it completed. */
  push(pkt: RtpPacket): AccessUnit[] {
    const out: AccessUnit[] = []

    // A gap means the picture in progress is incomplete. Note it before
    // anything else, so the packet that follows the gap starts cleanly.
    if (this.expectedSeq !== null && pkt.sequence !== this.expectedSeq) {
      this.fragments = []
      this.nals = []
    }
    this.expectedSeq = (pkt.sequence + 1) & 0xffff

    // A timestamp change also ends an access unit, for senders that do not
    // set the marker bit.
    if (this.currentTs !== null && pkt.timestamp !== this.currentTs && this.nals.length > 0) {
      const au = this.finish(this.currentTs)
      if (au) out.push(au)
    }
    this.currentTs = pkt.timestamp

    const p = pkt.payload
    if (p.length === 0) return out
    const type = p[0]! & 0x1f

    if (type >= 1 && type <= 23) {
      this.collect(p)
    } else if (type === PKT_STAP_A) {
      let i = 1
      while (i + 2 <= p.length) {
        const size = (p[i]! << 8) | p[i + 1]!
        i += 2
        if (size === 0 || i + size > p.length) break
        this.collect(p.subarray(i, i + size))
        i += size
      }
    } else if (type === PKT_FU_A) {
      if (p.length < 2) return out
      const start = (p[1]! & 0x80) !== 0
      const end = (p[1]! & 0x40) !== 0
      if (start) {
        // Rebuild the original NAL header from the indicator's F/NRI bits
        // and the fragment header's type.
        this.fragmentHeader = (p[0]! & 0xe0) | (p[1]! & 0x1f)
        this.fragments = [p.subarray(2)]
      } else if (this.fragments.length > 0) {
        this.fragments.push(p.subarray(2))
      }
      if (end && this.fragments.length > 0) {
        const size = this.fragments.reduce((n, f) => n + f.length, 0)
        const nal = new Uint8Array(size + 1)
        nal[0] = this.fragmentHeader
        let at = 1
        for (const f of this.fragments) {
          nal.set(f, at)
          at += f.length
        }
        this.fragments = []
        this.collect(nal)
      }
    }

    if (pkt.marker && this.nals.length > 0) {
      const au = this.finish(pkt.timestamp)
      if (au) out.push(au)
    }
    return out
  }

  private collect(nal: Uint8Array) {
    const t = nalType(nal)
    // Parameter sets are kept rather than queued: they are re-emitted ahead
    // of every keyframe, so a decoder that starts mid-stream has them.
    if (t === NAL_SPS) {
      this.sps = nal.slice()
      return
    }
    if (t === NAL_PPS) {
      this.pps = nal.slice()
      return
    }
    this.nals.push(nal)
  }

  private finish(timestamp: number): AccessUnit | null {
    const nals = this.nals
    this.nals = []
    if (nals.length === 0) return null
    const keyframe = nals.some((n) => nalType(n) === NAL_IDR)
    let parts = nals
    if (keyframe && this.sps && this.pps) {
      // An access unit delimiter, when a sender emits one, has to stay the
      // first NAL of the access unit -- so the parameter sets go after it,
      // not in front of it. Getting this backwards produces a stream that
      // libav happily decodes and Chromium rejects outright, with "a key
      // frame is required after configure()": its parser will not accept the
      // IDR that follows a misplaced delimiter, so the picture never appears.
      const lead = nals.length > 0 && nalType(nals[0]!) === NAL_AUD ? 1 : 0
      parts = [...nals.slice(0, lead), this.sps, this.pps, ...nals.slice(lead)]
    }
    return { data: toAnnexB(parts), keyframe, timestamp }
  }
}

const START_CODE = Uint8Array.of(0, 0, 0, 1)

/** Concatenates NAL units with 4-byte start codes. */
export function toAnnexB(nals: readonly Uint8Array[]): Uint8Array {
  let size = 0
  for (const n of nals) size += n.length + 4
  const out = new Uint8Array(size)
  let at = 0
  for (const n of nals) {
    out.set(START_CODE, at)
    out.set(n, at + 4)
    at += n.length + 4
  }
  return out
}

/**
 * The WebCodecs codec string for an SPS, e.g. `avc1.42e01e`.
 *
 * The three bytes after the NAL header are profile_idc, the constraint set
 * flags, and level_idc -- exactly what the codec string encodes.
 */
export function codecStringFromSps(sps: Uint8Array): string | null {
  if (sps.length < 4) return null
  const hex = (b: number) => b.toString(16).padStart(2, '0')
  return `avc1.${hex(sps[1]!)}${hex(sps[2]!)}${hex(sps[3]!)}`
}
