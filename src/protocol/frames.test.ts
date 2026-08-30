import { describe, expect, it } from 'vitest'
import { MavFramer, encodeFrame } from './frames'
import { decodeFrameFields } from './serializer'

const HEARTBEAT_FIELDS = {
  type: 2,
  autopilot: 3,
  baseMode: 81,
  customMode: 5,
  systemStatus: 4,
  mavlinkVersion: 3,
}

describe('MAVLink framing', () => {
  it('round-trips a HEARTBEAT through encode -> frame -> decode', () => {
    const bytes = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 7, 1, 1)
    const framer = new MavFramer()
    const frames = framer.push(bytes)
    expect(frames).toHaveLength(1)
    const frame = frames[0]!
    expect(frame.version).toBe(2)
    expect(frame.seq).toBe(7)
    expect(frame.sysid).toBe(1)
    expect(frame.msgid).toBe(0)
    const decoded = decodeFrameFields(frame.msgid, frame.payload)!
    expect(decoded.msgName).toBe('HEARTBEAT')
    expect(decoded.fields.customMode).toBe(5)
    expect(decoded.fields.baseMode).toBe(81)
    expect(decoded.fields.type).toBe(2)
  })

  it('round-trips floats and truncated payloads (ATTITUDE)', () => {
    const bytes = encodeFrame(
      'ATTITUDE',
      { timeBootMs: 123456, roll: 0.25, pitch: -0.125, yaw: 3.0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      0,
      1,
      1,
    )
    const frames = new MavFramer().push(bytes)
    expect(frames).toHaveLength(1)
    const fields = decodeFrameFields(30, frames[0]!.payload)!.fields
    expect(fields.timeBootMs).toBe(123456)
    expect(fields.roll).toBeCloseTo(0.25)
    expect(fields.pitch).toBeCloseTo(-0.125)
    // yawspeed was a trailing zero: v2 truncation must restore it as 0.
    expect(fields.yawspeed).toBe(0)
  })

  it('round-trips char[] fields (STATUSTEXT)', () => {
    const bytes = encodeFrame('STATUSTEXT', { severity: 6, text: 'hello vehicle' }, 0, 1, 1)
    const frames = new MavFramer().push(bytes)
    const fields = decodeFrameFields(frames[0]!.msgid, frames[0]!.payload)!.fields
    expect(fields.text).toBe('hello vehicle')
    expect(fields.severity).toBe(6)
  })

  it('resyncs when the stream starts mid-message', () => {
    const good = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 0, 1, 1)
    const garbage = good.subarray(5) // tail of a frame we never saw the start of
    const framer = new MavFramer()
    expect(framer.push(garbage)).toHaveLength(0)
    const frames = framer.push(good)
    expect(frames).toHaveLength(1)
    expect(framer.stats.droppedBytes).toBeGreaterThan(0)
  })

  it('drops a corrupted frame and recovers the next one', () => {
    const a = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 1, 1, 1)
    const b = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 2, 1, 1)
    const corrupted = a.slice()
    corrupted[12] = corrupted[12]! ^ 0xff // flip a payload byte; CRC must now fail
    const stream = new Uint8Array(corrupted.length + b.length)
    stream.set(corrupted)
    stream.set(b, corrupted.length)
    const frames = new MavFramer().push(stream)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.seq).toBe(2)
  })

  it('handles frames split across arbitrary chunk boundaries', () => {
    const a = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 1, 1, 1)
    const b = encodeFrame(
      'GLOBAL_POSITION_INT',
      { timeBootMs: 1, lat: -353632620, lon: 1491652370, alt: 584000, relativeAlt: 0, vx: 0, vy: 0, vz: 0, hdg: 9000 },
      2,
      1,
      1,
    )
    const stream = new Uint8Array(a.length + b.length)
    stream.set(a)
    stream.set(b, a.length)

    // Feed one byte at a time -- the cruelest chunking a serial port can do.
    const framer = new MavFramer()
    const frames = []
    for (const byte of stream) frames.push(...framer.push(new Uint8Array([byte])))
    expect(frames).toHaveLength(2)
    const pos = decodeFrameFields(frames[1]!.msgid, frames[1]!.payload)!.fields
    expect(pos.lat).toBe(-353632620)
    expect(pos.hdg).toBe(9000)
  })

  it('parses MAVLink v1 frames too', () => {
    // Hand-build a v1 HEARTBEAT: FE len seq sys comp msgid payload crc.
    // Reuse the v2 encoder's payload+CRC math via a known-good v2 frame is
    // not possible (different header), so construct directly.
    const v2 = encodeFrame('HEARTBEAT', HEARTBEAT_FIELDS, 0, 1, 1)
    const payload = v2.subarray(10, v2.length - 2)
    const frame = new Uint8Array(6 + 9 + 2)
    frame[0] = 0xfe
    frame[1] = 9
    frame[2] = 0
    frame[3] = 1
    frame[4] = 1
    frame[5] = 0 // HEARTBEAT
    // v1 payload is never truncated
    const full = new Uint8Array(9)
    full.set(payload)
    frame.set(full, 6)
    // CRC over len..payload with CRC_EXTRA 50 (HEARTBEAT)
    let crc = 0xffff
    const digest = (byte: number) => {
      let tmp = (byte & 0xff) ^ (crc & 0xff)
      tmp ^= tmp << 4
      tmp &= 0xff
      crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
    }
    for (let i = 1; i < frame.length - 2; i++) digest(frame[i]!)
    digest(50)
    frame[frame.length - 2] = crc & 0xff
    frame[frame.length - 1] = (crc >> 8) & 0xff

    const frames = new MavFramer().push(frame)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.version).toBe(1)
    const decoded = decodeFrameFields(0, frames[0]!.payload)!
    expect(decoded.fields.customMode).toBe(5)
  })
})
