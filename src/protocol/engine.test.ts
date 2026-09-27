import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtocolEngine } from './engine'
import { encodeFrame } from './frames'
import { decodeFrameFields } from './serializer'
import type { EngineOutput } from './types'

function vehicleHeartbeat(seq = 0) {
  return encodeFrame(
    'HEARTBEAT',
    {
      type: 2,
      autopilot: 3,
      baseMode: 81 | 128,
      customMode: 6,
      systemStatus: 4,
      mavlinkVersion: 3,
    },
    seq,
    1,
    1, // sysid 1, compid 1: the autopilot
  )
}

describe('ProtocolEngine', () => {
  let outputs: EngineOutput[]
  let engine: ProtocolEngine

  beforeEach(() => {
    vi.useFakeTimers()
    outputs = []
    engine = new ProtocolEngine((o) => outputs.push(o))
  })

  afterEach(() => {
    engine.stop()
    vi.useRealTimers()
  })

  const events = () => outputs.filter((o) => o.t === 'evt').map((o) => o.evt)
  const txMessages = () =>
    outputs
      .filter((o) => o.t === 'tx')
      .map((o) => {
        // Decode our own tx frames: msgid is bytes 7..9 of a v2 frame.
        const msgid = o.bytes[7]! | (o.bytes[8]! << 8) | (o.bytes[9]! << 16)
        return decodeFrameFields(msgid, o.bytes.subarray(10, o.bytes.length - 2))!.msgName
      })

  it('emits a heartbeat event and requests streams on first vehicle heartbeat', () => {
    engine.start()
    engine.pushBytes(vehicleHeartbeat())
    const hb = events().find((e) => e.t === 'heartbeat')
    expect(hb).toBeDefined()
    if (hb?.t === 'heartbeat') {
      expect(hb.sysid).toBe(1)
      expect(hb.customMode).toBe(6)
      expect(hb.baseMode & 128).toBe(128)
    }
    expect(txMessages()).toContain('HEARTBEAT') // our GCS heartbeat
    expect(txMessages()).toContain('REQUEST_DATA_STREAM')
  })

  it('ignores heartbeats from non-autopilot components', () => {
    engine.start()
    const gimbal = encodeFrame(
      'HEARTBEAT',
      { type: 26, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 },
      0,
      1,
      154, // MAV_COMP_ID_GIMBAL
    )
    engine.pushBytes(gimbal)
    expect(events().find((e) => e.t === 'heartbeat')).toBeUndefined()
  })

  it('batches telemetry and flushes on the timer', () => {
    engine.start()
    engine.pushBytes(vehicleHeartbeat())
    const att = encodeFrame(
      'ATTITUDE',
      { timeBootMs: 1, roll: 0.1, pitch: 0.2, yaw: 0.3, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      1,
      1,
      1,
    )
    engine.pushBytes(att)
    expect(events().find((e) => e.t === 'telemetry')).toBeUndefined() // not yet flushed
    vi.advanceTimersByTime(60)
    const tel = events().find((e) => e.t === 'telemetry')
    expect(tel).toBeDefined()
    if (tel?.t === 'telemetry') {
      expect(tel.batch[0]).toMatchObject({ k: 'attitude' })
    }
  })

  it('emits statustext events', () => {
    engine.start()
    engine.pushBytes(encodeFrame('STATUSTEXT', { severity: 4, text: 'PreArm: check' }, 0, 1, 1))
    const st = events().find((e) => e.t === 'statustext')
    expect(st).toMatchObject({ severity: 4, text: 'PreArm: check' })
  })

  it('reports link stats with heartbeat age', () => {
    engine.start()
    engine.pushBytes(vehicleHeartbeat())
    vi.advanceTimersByTime(1000)
    const stats = events()
      .filter((e) => e.t === 'linkStats')
      .at(-1)
    expect(stats).toBeDefined()
    if (stats?.t === 'linkStats') {
      expect(stats.stats.heartbeatAgeMs).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('the inspector', () => {
  let outputs: EngineOutput[]
  let engine: ProtocolEngine

  beforeEach(() => {
    vi.useFakeTimers()
    outputs = []
    engine = new ProtocolEngine((o) => outputs.push(o))
    engine.start()
  })
  afterEach(() => {
    engine.stop()
    vi.useRealTimers()
  })

  const rows = () => {
    const evts = outputs.filter((o) => o.t === 'evt' && o.evt.t === 'inspector')
    const last = evts[evts.length - 1]
    return last && last.t === 'evt' && last.evt.t === 'inspector' ? last.evt.rows : []
  }
  const attitude = (seq: number) =>
    encodeFrame(
      'ATTITUDE',
      { timeBootMs: seq, roll: 0.1, pitch: 0, yaw: 1.5, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      seq,
      1,
      1,
    )

  it('says nothing until someone is watching', () => {
    engine.pushBytes(vehicleHeartbeat(0))
    vi.advanceTimersByTime(2000)
    expect(rows()).toHaveLength(0)
  })

  it('reports every message type with its count, rate and last fields', () => {
    engine.setInspecting(true)
    for (let i = 0; i < 8; i++) engine.pushBytes(attitude(i))
    engine.pushBytes(vehicleHeartbeat(8))
    vi.advanceTimersByTime(500)

    const att = rows().find((r) => r.msgName === 'ATTITUDE')!
    expect(att.count).toBe(8)
    expect(att.sysid).toBe(1)
    expect(att.compid).toBe(1)
    // The freshest payload rides along, decoded.
    expect(att.fields['yaw']).toBeCloseTo(1.5, 5)
    expect(rows().find((r) => r.msgName === 'HEARTBEAT')!.count).toBe(1)
  })

  it('converges the rate onto the true arrival rate', () => {
    engine.setInspecting(true)
    // 10 Hz for four seconds of fake time: four messages per 400 ms window.
    let seq = 0
    for (let w = 0; w < 10; w++) {
      for (let i = 0; i < 4; i++) engine.pushBytes(attitude(seq++))
      vi.advanceTimersByTime(400)
    }
    const att = rows().find((r) => r.msgName === 'ATTITUDE')!
    expect(att.hz).toBeGreaterThan(8)
    expect(att.hz).toBeLessThan(12)
  })

  it('keeps senders apart, echoes included', () => {
    engine.setInspecting(true)
    engine.pushBytes(vehicleHeartbeat(0))
    // Our own heartbeat echoed back (a UDP loop). The vehicle logic ignores
    // it, but the inspector shows it so the loop can be diagnosed.
    engine.pushBytes(
      encodeFrame(
        'HEARTBEAT',
        { type: 6, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 },
        0,
        255,
        190,
      ),
    )
    vi.advanceTimersByTime(500)
    const hb = rows().filter((r) => r.msgName === 'HEARTBEAT')
    expect(hb).toHaveLength(2)
    expect(hb.map((r) => r.sysid).sort()).toEqual([1, 255])
  })

  it('stops the snapshots when told, and forgets the link on stop', () => {
    engine.setInspecting(true)
    engine.pushBytes(vehicleHeartbeat(0))
    vi.advanceTimersByTime(500)
    const before = outputs.length
    engine.setInspecting(false)
    vi.advanceTimersByTime(2000)
    expect(
      outputs.filter((o, i) => i >= before && o.t === 'evt' && o.evt.t === 'inspector'),
    ).toHaveLength(0)

    // A new link is a new story: counts do not leak across connections.
    engine.stop()
    engine.start()
    engine.setInspecting(true)
    vi.advanceTimersByTime(500)
    expect(rows()).toHaveLength(0)
  })
})
