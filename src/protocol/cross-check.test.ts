// Cross-check: frames produced by our encoder must parse in node-mavlink,
// the ArduPilot-org reference JS implementation. This is the guard against
// quietly diverging from the wire format -- the failure mode that killed the
// original ArduConfigurator.
import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { MavLinkPacketSplitter, MavLinkPacketParser, type MavLinkPacket } from 'node-mavlink'
import { encodeFrame } from './frames'

function parseWithNodeMavlink(bytes: Uint8Array): Promise<MavLinkPacket[]> {
  return new Promise((resolve, reject) => {
    const source = new PassThrough()
    const parsed: MavLinkPacket[] = []
    source
      .pipe(new MavLinkPacketSplitter())
      .pipe(new MavLinkPacketParser())
      .on('data', (p: MavLinkPacket) => parsed.push(p))
      .on('end', () => resolve(parsed))
      .on('error', reject)
    source.end(Buffer.from(bytes))
  })
}

describe('cross-check against node-mavlink', () => {
  it('our HEARTBEAT parses in the reference implementation', async () => {
    const bytes = encodeFrame(
      'HEARTBEAT',
      { type: 6, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 },
      9,
      255,
      190,
    )
    const packets = await parseWithNodeMavlink(bytes)
    expect(packets).toHaveLength(1)
    const p = packets[0]!
    expect(p.header.msgid).toBe(0)
    expect(p.header.sysid).toBe(255)
    expect(p.header.compid).toBe(190)
    expect(p.header.seq).toBe(9)
  })

  it('our REQUEST_DATA_STREAM parses in the reference implementation', async () => {
    const bytes = encodeFrame(
      'REQUEST_DATA_STREAM',
      { targetSystem: 1, targetComponent: 1, reqStreamId: 0, reqMessageRate: 4, startStop: 1 },
      0,
      255,
      190,
    )
    const packets = await parseWithNodeMavlink(bytes)
    expect(packets).toHaveLength(1)
    expect(packets[0]!.header.msgid).toBe(66)
  })
})
