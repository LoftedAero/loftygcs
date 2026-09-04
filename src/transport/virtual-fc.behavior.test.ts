import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtocolEngine } from '../protocol/engine'
import { VirtualFcTransport } from './virtual-fc'
import type { EngineOutput, ProtocolEvent } from '../protocol/types'

// The ArduPilot rules the demo vehicle enforces.
//
// Every one of these was observed against real SITL first -- that is the
// entry requirement, because a rule invented here would teach the app a
// lesson ArduPilot never gives and any test written against it would bake
// the mistake in. Two of them exist because their absence let real bugs
// ship: the vehicle used to accept NAV_TAKEOFF in any mode, and used to
// accept every mode change instantly.

const STABILIZE = 0
const AUTO = 3
const GUIDED = 4
const ARM = 400
const SET_MODE = 176
const TAKEOFF = 22
const ACCEPTED = 0
const FAILED = 4

describe('the demo vehicle enforces the rules SITL enforces', () => {
  let engine: ProtocolEngine
  let fc: VirtualFcTransport
  let events: ProtocolEvent[]

  beforeEach(async () => {
    vi.useFakeTimers()
    events = []
    fc = new VirtualFcTransport()
    engine = new ProtocolEngine((out: EngineOutput) => {
      if (out.t === 'tx') fc.write(out.bytes)
      else if (out.t === 'evt') events.push(out.evt)
    })
    fc.onData((bytes) => engine.pushBytes(bytes))
    await fc.open({} as never)
  })

  afterEach(async () => {
    engine.stop()
    await fc.close()
    vi.useRealTimers()
  })

  /** Run a command and settle the fake clock enough for the ack to arrive. */
  const run = async (command: number, params: number[]) => {
    const promise = engine.runCommand(command, params, 5000)
    await vi.advanceTimersByTimeAsync(50)
    return promise
  }

  const said = () =>
    events
      .filter((e) => e.t === 'statustext')
      .map((e) => (e.t === 'statustext' ? e.text : ''))

  /** Skip past the simulated EKF settling. */
  const settle = () => vi.advanceTimersByTimeAsync(4500)

  it('refuses to arm before it has a position estimate', async () => {
    expect(await run(ARM, [1, 0, 0, 0, 0, 0, 0])).toBe(FAILED)
    expect(said().join(' ')).toMatch(/Need Position Estimate/)
  })

  it('refuses a position-holding mode until the estimate arrives', async () => {
    expect(await run(SET_MODE, [1, GUIDED, 0, 0, 0, 0, 0])).toBe(FAILED)
    // The vehicle's own sentence, which is what the Fly screen reports.
    expect(said().join(' ')).toMatch(/Mode change to Guided failed: requires position/)
    await settle()
    expect(await run(SET_MODE, [1, GUIDED, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
  })

  it('still allows Stabilize, which needs no position', async () => {
    expect(await run(SET_MODE, [1, STABILIZE, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
  })

  it('refuses a takeoff commanded from Stabilize', async () => {
    // The bug this rule exists for. The old demo vehicle accepted this, so
    // the Takeoff button looked correct here and did nothing on a real
    // aircraft, which then disarmed itself on the ground.
    await settle()
    expect(await run(ARM, [1, 0, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    expect(await run(SET_MODE, [1, STABILIZE, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    expect(await run(TAKEOFF, [0, 0, 0, 0, 0, 0, 20])).toBe(FAILED)
  })

  it('accepts the same takeoff once in Guided', async () => {
    await settle()
    await run(ARM, [1, 0, 0, 0, 0, 0, 0])
    expect(await run(SET_MODE, [1, GUIDED, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    expect(await run(TAKEOFF, [0, 0, 0, 0, 0, 0, 20])).toBe(ACCEPTED)
  })

  it('will not take off unarmed, whatever the mode', async () => {
    await settle()
    await run(SET_MODE, [1, GUIDED, 0, 0, 0, 0, 0])
    expect(await run(TAKEOFF, [0, 0, 0, 0, 0, 0, 20])).toBe(FAILED)
  })

  it('disarms itself after sitting armed on the ground', async () => {
    // Past the scripted lift-off first, then back on the ground: the rule is
    // about a vehicle sitting armed and idle, and the demo's own showreel is
    // airborne by nine seconds.
    await vi.advanceTimersByTimeAsync(9000)
    expect(await run(ARM, [0, 0, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    expect(await run(ARM, [1, 0, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    events.length = 0
    await vi.advanceTimersByTimeAsync(11000)
    expect(said().join(' ')).toMatch(/Disarming motors/)
    // Which is exactly how a takeoff that never reached Guided ended up
    // looking like nothing happened at all.
    expect(await run(TAKEOFF, [0, 0, 0, 0, 0, 0, 20])).toBe(FAILED)
  })

  it('sits at the first mission item when Auto is entered on the ground', async () => {
    await settle()
    await run(ARM, [1, 0, 0, 0, 0, 0, 0])
    expect(await run(SET_MODE, [1, AUTO, 0, 0, 0, 0, 0])).toBe(ACCEPTED)
    // Accepted and going nowhere: Copter waits for a throttle raise that a
    // ground station has no way to give it.
    expect(said().join(' ')).toMatch(/Mission: 1 Takeoff/)
  })
})
