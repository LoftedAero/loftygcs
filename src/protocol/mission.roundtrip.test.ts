// The full mission loop over real MAVLink bytes: engine wired to the virtual
// FC, both using the real encoder and framer. This is the test that catches
// a wrong field name in a MISSION_* message -- the scripted unit tests hand
// the client already-decoded fields, so they cannot.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProtocolEngine } from './engine'
import { VirtualFcTransport } from '../transport/virtual-fc'
import type { EngineOutput, MissionItem } from './types'

const wire = (seq: number, over: Partial<MissionItem>): MissionItem => ({
  seq,
  frame: 0,
  command: 16,
  current: 0,
  autocontinue: 1,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
  x: 0,
  y: 0,
  z: 0,
  ...over,
})

describe('mission round trip against the virtual FC', () => {
  let engine: ProtocolEngine
  let fc: VirtualFcTransport

  beforeEach(async () => {
    fc = new VirtualFcTransport()
    engine = new ProtocolEngine((out: EngineOutput) => {
      if (out.t === 'tx') fc.write(out.bytes)
    })
    fc.onData((bytes) => engine.pushBytes(bytes))
    await fc.open({} as never)
  })

  afterEach(async () => {
    engine.stop()
    await fc.close()
  })

  it('downloads, uploads a change, and reads the same mission back', async () => {
    const stored = await engine.downloadMission(0)
    // The demo mission: home, takeoff, four corners, RTL.
    expect(stored.length).toBe(7)
    expect(stored[0]!.seq).toBe(0)
    expect(stored[1]!.command).toBe(22)
    expect(stored[6]!.command).toBe(20)
    // Coordinates survive the int path exactly.
    expect(stored[0]!.x).toBe(Math.round(-35.363262 * 1e7))

    const edited = stored.slice(0, 5).map((it, seq) => ({ ...it, seq, z: it.z + 5 }))
    await engine.uploadMission(edited, 0)

    const back = await engine.downloadMission(0)
    expect(back).toEqual(edited)
  })

  it('clears and reads back an empty mission', async () => {
    await engine.clearMission(0)
    expect(await engine.downloadMission(0)).toEqual([])
  })

  it('keeps the three plans apart, as mission_type says it should', async () => {
    // The demo vehicle used to answer anything but mission_type 0 with
    // "unsupported", which left the fence and rally screens with nothing to
    // talk to in the browser build. It stores all three now, and the point
    // of this test is that they do not leak into each other.
    const fence = [
      wire(0, { command: 5001, param1: 3, x: 1, y: 1 }),
      wire(1, { command: 5001, param1: 3, x: 2, y: 1 }),
      wire(2, { command: 5001, param1: 3, x: 2, y: 2 }),
    ]
    const rally = [wire(0, { command: 5100, x: 9, y: 9, z: 60 })]
    await engine.uploadMission(fence, 1)
    await engine.uploadMission(rally, 2)

    const readFence = await engine.downloadMission(1)
    expect(readFence).toHaveLength(3)
    expect(readFence.every((i) => i.command === 5001)).toBe(true)
    expect(await engine.downloadMission(2)).toHaveLength(1)
    // And the mission the vehicle started with is untouched by either.
    expect((await engine.downloadMission(0)).length).toBeGreaterThan(1)
  })
})
