import { describe, expect, it } from 'vitest'
import {
  H264Depayloader,
  codecStringFromSps,
  nalType,
  parseRtp,
  toAnnexB,
} from './h264'

/** Builds an RTP packet around a payload. */
function rtp(
  payload: number[],
  opts: { seq?: number; ts?: number; marker?: boolean; pt?: number } = {},
): Uint8Array {
  const { seq = 0, ts = 0, marker = false, pt = 96 } = opts
  const buf = new Uint8Array(12 + payload.length)
  buf[0] = 0x80
  buf[1] = (marker ? 0x80 : 0) | pt
  buf[2] = (seq >> 8) & 0xff
  buf[3] = seq & 0xff
  buf[4] = (ts >>> 24) & 0xff
  buf[5] = (ts >>> 16) & 0xff
  buf[6] = (ts >>> 8) & 0xff
  buf[7] = ts & 0xff
  buf.set(payload, 12)
  return buf
}

const nal = (type: number, ...body: number[]) => [0x60 | type, ...body]
const SPS = nal(7, 0x42, 0xe0, 0x1e, 0xaa)
const PPS = nal(8, 0xce)

describe('parseRtp', () => {
  it('reads the fields that matter', () => {
    const p = parseRtp(rtp([1, 2, 3], { seq: 0x1234, ts: 0xdeadbeef, marker: true, pt: 97 }))!
    expect(p.sequence).toBe(0x1234)
    expect(p.timestamp).toBe(0xdeadbeef)
    expect(p.marker).toBe(true)
    expect(p.payloadType).toBe(97)
    expect([...p.payload]).toEqual([1, 2, 3])
  })

  it('skips CSRC entries and header extensions', () => {
    // Miscounting either feeds the tail of the header to the decoder as a NAL.
    const buf = new Uint8Array(12 + 8 + 4 + 4 + 2)
    buf[0] = 0x80 | 0x10 | 2 // extension + 2 CSRCs
    buf[1] = 96
    buf[12 + 8 + 2] = 0 // extension length high
    buf[12 + 8 + 3] = 1 // one 32-bit word of extension
    buf[12 + 8 + 4 + 4] = 0xaa
    buf[12 + 8 + 4 + 4 + 1] = 0xbb
    const p = parseRtp(buf)!
    expect([...p.payload]).toEqual([0xaa, 0xbb])
  })

  it('strips padding', () => {
    const buf = new Uint8Array(12 + 5)
    buf[0] = 0x80 | 0x20
    buf[1] = 96
    buf[12] = 0x41
    buf[16] = 4 // four padding bytes including this one
    expect([...parseRtp(buf)!.payload]).toEqual([0x41])
  })

  it('rejects what is not RTP version 2, or is too short', () => {
    expect(parseRtp(new Uint8Array(4))).toBeNull()
    const wrongVersion = rtp([1])
    wrongVersion[0] = 0x00
    expect(parseRtp(wrongVersion)).toBeNull()
  })
})

describe('H264Depayloader', () => {
  it('passes a single-NAL packet through', () => {
    const d = new H264Depayloader()
    const out = d.push(parseRtp(rtp(nal(1, 0xaa), { marker: true }))!)
    expect(out).toHaveLength(1)
    // Annex-B: start code then the NAL.
    expect([...out[0]!.data]).toEqual([0, 0, 0, 1, 0x61, 0xaa])
    expect(out[0]!.keyframe).toBe(false)
  })

  it('reassembles a NAL split across FU-A packets', () => {
    const d = new H264Depayloader()
    d.setParameterSets(Uint8Array.from(SPS), Uint8Array.from(PPS))
    const ind = 0x60 | 28
    d.push(parseRtp(rtp([ind, 0x80 | 5, 0x11, 0x22], { seq: 1 }))!)
    d.push(parseRtp(rtp([ind, 0x05, 0x33], { seq: 2 }))!)
    const out = d.push(parseRtp(rtp([ind, 0x40 | 5, 0x44], { seq: 3, marker: true }))!)
    expect(out).toHaveLength(1)
    const au = out[0]!
    expect(au.keyframe).toBe(true)
    // SPS and PPS are prepended to the keyframe, then the rebuilt IDR whose
    // header carries the indicator's NRI bits and the fragment's type.
    const bytes = [...au.data]
    expect(bytes.slice(0, 4)).toEqual([0, 0, 0, 1])
    expect(bytes.slice(4, 9)).toEqual(SPS)
    expect(bytes.slice(13, 15)).toEqual(PPS)
    expect(bytes.slice(-5)).toEqual([0x65, 0x11, 0x22, 0x33, 0x44])
  })

  it('splits a STAP-A into its NAL units', () => {
    const d = new H264Depayloader()
    const body = [
      0x60 | 24,
      0,
      SPS.length,
      ...SPS,
      0,
      PPS.length,
      ...PPS,
      0,
      2,
      ...nal(1, 0x99),
    ]
    d.push(parseRtp(rtp(body, { marker: true }))!)
    const sets = d.parameterSets()
    expect([...(sets.sps ?? [])]).toEqual(SPS)
    expect([...(sets.pps ?? [])]).toEqual(PPS)
  })

  it('throws away a picture with a gap in it', () => {
    const d = new H264Depayloader()
    const ind = 0x60 | 28
    d.push(parseRtp(rtp([ind, 0x80 | 1, 0x11], { seq: 1 }))!)
    // seq 2 is lost.
    const out = d.push(parseRtp(rtp([ind, 0x40 | 1, 0x33], { seq: 3, marker: true }))!)
    expect(out).toEqual([])
  })

  it('ends an access unit on a timestamp change when the marker never comes', () => {
    const d = new H264Depayloader()
    d.push(parseRtp(rtp(nal(1, 0xaa), { seq: 1, ts: 1000 }))!)
    const out = d.push(parseRtp(rtp(nal(1, 0xbb), { seq: 2, ts: 4000 }))!)
    expect(out).toHaveLength(1)
    expect(out[0]!.timestamp).toBe(1000)
  })

  it('re-sends the parameter sets with every keyframe', () => {
    // A decoder joining mid-stream needs them, and cameras send them rarely.
    const d = new H264Depayloader()
    d.setParameterSets(Uint8Array.from(SPS), Uint8Array.from(PPS))
    const first = d.push(parseRtp(rtp(nal(5, 0x01), { seq: 1, marker: true }))!)[0]!
    const second = d.push(parseRtp(rtp(nal(5, 0x02), { seq: 2, ts: 3000, marker: true }))!)[0]!
    for (const au of [first, second]) {
      expect([...au.data].slice(4, 9)).toEqual(SPS)
      expect(au.keyframe).toBe(true)
    }
  })

  it('does not prepend parameter sets to a non-keyframe', () => {
    const d = new H264Depayloader()
    d.setParameterSets(Uint8Array.from(SPS), Uint8Array.from(PPS))
    const au = d.push(parseRtp(rtp(nal(1, 0x01), { marker: true }))!)[0]!
    expect([...au.data]).toEqual([0, 0, 0, 1, 0x61, 0x01])
  })

  it('ignores packet types nothing in the wild produces', () => {
    const d = new H264Depayloader()
    for (const t of [25, 26, 27, 29]) {
      expect(d.push(parseRtp(rtp([0x60 | t, 1, 2, 3], { marker: true }))!)).toEqual([])
    }
  })
})

describe('access unit delimiters', () => {
  /** The NAL types of an Annex-B buffer, in order. */
  function order(data: Uint8Array): number[] {
    const types: number[] = []
    for (let i = 0; i + 4 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
        types.push((data[i + 4] ?? 0) & 0x1f)
        i += 3
      }
    }
    return types
  }

  it('keeps a delimiter first, ahead of the parameter sets', () => {
    // x264 and most cameras put an AUD at the head of every access unit.
    // SPS/PPS in front of it decode in libav but Chromium rejects the stream.
    const d = new H264Depayloader()
    d.setParameterSets(Uint8Array.from(SPS), Uint8Array.from(PPS))
    d.push(parseRtp(rtp(nal(9, 0x10), { seq: 0 }))!)
    const units = d.push(parseRtp(rtp(nal(5, 0xaa), { seq: 1, marker: true }))!)

    expect(units).toHaveLength(1)
    expect(units[0]!.keyframe).toBe(true)
    expect(order(units[0]!.data)).toEqual([9, 7, 8, 5])
  })

  it('puts the parameter sets first when there is no delimiter', () => {
    const d = new H264Depayloader()
    d.setParameterSets(Uint8Array.from(SPS), Uint8Array.from(PPS))
    const units = d.push(parseRtp(rtp(nal(5, 0xaa), { seq: 0, marker: true }))!)
    expect(order(units[0]!.data)).toEqual([7, 8, 5])
  })
})

describe('toAnnexB and nalType', () => {
  it('prefixes every NAL with a start code', () => {
    expect([...toAnnexB([Uint8Array.of(0x67, 1), Uint8Array.of(0x68)])]).toEqual([
      0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68,
    ])
  })

  it('reads the type out of the NAL header', () => {
    expect(nalType(Uint8Array.of(0x67))).toBe(7)
    expect(nalType(Uint8Array.of(0x65))).toBe(5)
  })
})

describe('codecStringFromSps', () => {
  it('builds the string WebCodecs wants from the SPS', () => {
    // profile_idc 0x42, constraints 0xe0, level_idc 0x1e -> baseline 3.0.
    expect(codecStringFromSps(Uint8Array.of(0x67, 0x42, 0xe0, 0x1e))).toBe('avc1.42e01e')
    expect(codecStringFromSps(Uint8Array.of(0x67, 0x64, 0x00, 0x28))).toBe('avc1.640028')
  })

  it('returns null for an SPS too short to read', () => {
    expect(codecStringFromSps(Uint8Array.of(0x67, 0x42))).toBeNull()
  })
})
