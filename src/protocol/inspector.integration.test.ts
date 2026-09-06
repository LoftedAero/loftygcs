// @vitest-environment node
//
// The inspector against real ArduPilot: the counts, rates and fields it
// reports come from a live SITL rather than frames this repo encoded for
// itself. Start SITL first (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import type { InspectorRow, ProtocolEvent } from './types'

describe.runIf(process.env.SITL === '1')('inspector against SITL', () => {
  it('reports the vehicle traffic with plausible rates and decoded fields', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((out) => {
      if (out.t === 'tx') socket?.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    // Retried: the runner relaunches SITL between files, and connecting
    // into that gap is a race, not a result.
    socket = await connectSitl()
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()
    engine.setInspecting(true)

    // Long enough for the EMA to settle onto the real rates.
    await new Promise((r) => setTimeout(r, 8000))
    const snapshots = events.filter(
      (e): e is { t: 'inspector'; rows: InspectorRow[] } => e.t === 'inspector',
    )
    engine.stop()
    socket.destroy()

    expect(snapshots.length).toBeGreaterThan(10)
    const rows = snapshots[snapshots.length - 1]!.rows
    const byName = (n: string) => rows.find((r) => r.msgName === n)

    // The one rate MAVLink pins down: HEARTBEAT is 1 Hz by definition.
    const hb = byName('HEARTBEAT')!
    expect(hb).toBeDefined()
    expect(hb.sysid).toBe(1)
    expect(hb.compid).toBe(1)
    expect(hb.hz).toBeGreaterThan(0.5)
    expect(hb.hz).toBeLessThan(2)

    // Streamed telemetry arrives at the rate the engine asked for (4 Hz),
    // with real decoded fields inside.
    const att = byName('ATTITUDE')!
    expect(att).toBeDefined()
    expect(att.hz).toBeGreaterThan(1)
    expect(att.count).toBeGreaterThan(8)
    expect(typeof att.fields['roll']).toBe('number')

    // A healthy SITL session talks in many voices, not three.
    expect(rows.length).toBeGreaterThan(10)
    // Counts are cumulative and never regress across snapshots.
    const prev = snapshots[snapshots.length - 2]!.rows.find((r) => r.msgName === 'ATTITUDE')!
    expect(att.count).toBeGreaterThanOrEqual(prev.count)
  }, 60000)
})
