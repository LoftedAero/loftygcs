// @vitest-environment node
//
// The EKF pill's and window's inputs against a live vehicle. Start SITL
// (npm run sitl), then SITL=1 npm test.
import { describe, expect, it } from 'vitest'
import type net from 'node:net'
import { connectSitl } from '../test-fixtures/sitl-client'
import { ProtocolEngine } from './engine'
import { EKF_FLAGS, estimatorIndicator } from './estimator'
import { SENSOR_BITS } from './sensors'
import type { EkfStatus, ProtocolEvent } from './types'

async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe.runIf(process.env.SITL === '1')('estimator against SITL', () => {
  it('reports a settled EKF, and the AHRS bit the pill reads', async () => {
    const events: ProtocolEvent[] = []
    let socket: net.Socket | null = null
    const engine = new ProtocolEngine((o) => {
      if (o.t === 'tx') socket?.write(o.bytes)
      else if (o.t === 'evt') events.push(o.evt)
    })
    socket = await connectSitl()
    socket.on('data', (d) => engine.pushBytes(new Uint8Array(d)))
    engine.start()

    let ekf: EkfStatus | null = null
    let sensors: { present: number; health: number } | null = null
    const latest = () => {
      for (const e of events) {
        if (e.t !== 'telemetry') continue
        for (const d of e.batch) {
          if (d.k === 'ekf') ekf = d.status
          if (d.k === 'sensors') sensors = { present: d.present, health: d.health }
        }
      }
    }
    try {
      // EKF_STATUS_REPORT decodes, and a settled EKF has its attitude.
      await waitFor(
        () => {
          latest()
          return ((ekf?.flags ?? 0) & EKF_FLAGS.attitude) !== 0
        },
        60000,
        'an EKF report with an attitude solution',
      )
      for (const v of Object.values(ekf!)) expect(Number.isFinite(v)).toBe(true)
      expect(ekf!.velocityVariance).toBeLessThan(0.8)

      // The AHRS bit the pill reads is reported, and set once settled.
      await waitFor(
        () => {
          latest()
          return ((sensors?.health ?? 0) & SENSOR_BITS.ahrs) !== 0
        },
        60000,
        'a healthy AHRS bit',
      )

      // After a fresh boot the EKF holds a constant position, which the pill
      // shows amber, until it starts using GPS.
      await waitFor(
        () => {
          latest()
          const flags = ekf?.flags ?? 0
          return (flags & EKF_FLAGS.posHorizAbs) !== 0 && (flags & EKF_FLAGS.constPosMode) === 0
        },
        120000,
        'the EKF using GPS',
      )
      expect(
        estimatorIndicator({
          ahrsEkfType: 3,
          sensorsPresent: sensors!.present,
          sensorsHealth: sensors!.health,
          ahrsBit: SENSOR_BITS.ahrs,
          ekf,
          announced: null,
          ekfFailsafe: false,
        }),
      ).toEqual({ label: 'EKF3', tone: 'ok' })
    } finally {
      engine.stop()
      socket.destroy()
    }
  }, 300000)
})
