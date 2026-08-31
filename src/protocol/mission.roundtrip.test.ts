// The full mission loop over real MAVLink bytes: engine wired to the virtual
// FC, both using the real encoder and framer. This is the test that catches
// a wrong field name in a MISSION_* message -- the scripted unit tests hand
// the client already-decoded fields, so they cannot.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProtocolEngine } from './engine'
import { VirtualFcTransport } from '../transport/virtual-fc'
import type { EngineOutput } from './types'

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

  it('acks a fence request as unsupported instead of stalling', async () => {
    await expect(engine.downloadMission(1)).rejects.toThrow(/Unsupported|no MISSION_COUNT/)
  })
})
