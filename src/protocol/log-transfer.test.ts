import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogTransferClient } from './log-transfer'
import type { FieldValue } from './types'

// A strict model of AP_Logger_MAVLinkLogTransfer.cpp: requests arrive a tick
// after they are sent, a data request that arrives while a stream is running
// is dropped, a stream ends with a short packet or at the requested count,
// and nothing is answered while armed.
class FakeVehicle {
  armed = false
  sending = false
  /** Packets to lose, by message and offset or id. */
  loseData = new Set<number>()
  loseEntries = new Set<number>()
  /** Packets per stream a radio behind the vehicle can carry; the rest are lost. */
  capacity = Infinity
  /** Requests as received, for assertions. */
  received: { msgName: string; fields: Record<string, FieldValue> }[] = []
  client: LogTransferClient

  constructor(
    private logs: Uint8Array[],
    /** What LOG_ENTRY reports as each log's size, if not its length. */
    private listedSize: (i: number) => number = (i) => logs[i]!.length,
  ) {
    this.client = new LogTransferClient(
      (msgName, fields) => setTimeout(() => this.receive(msgName, fields), 0),
      () => ({ sysid: 1, compid: 1 }),
    )
  }

  private receive(msgName: string, fields: Record<string, FieldValue>) {
    this.received.push({ msgName, fields })
    if (this.armed) return
    if (msgName === 'LOG_REQUEST_END') {
      this.sending = false
    } else if (msgName === 'LOG_REQUEST_LIST') {
      const num = this.logs.length
      if (num === 0) {
        this.entry(0, 0)
        return
      }
      const start = Math.max(1, fields.start as number)
      const end = Math.min(num, fields.end as number)
      for (let id = start; id <= end; id++) {
        if (this.loseEntries.delete(id)) continue
        this.entry(id, num)
      }
    } else if (msgName === 'LOG_REQUEST_DATA') {
      if (this.sending) return
      const id = fields.id as number
      const log = this.logs[id - 1]
      if (!log) return
      const size = this.listedSize(id - 1)
      let ofs = fields.ofs as number
      let remaining = Math.min(Math.max(0, size - ofs), fields.count as number)
      const packets: Record<string, FieldValue>[] = []
      for (;;) {
        const len = Math.min(90, remaining)
        const chunk = log.slice(ofs, ofs + len)
        const data = new Array<number>(90).fill(0)
        chunk.forEach((b, i) => (data[i] = b))
        packets.push({ id, ofs, count: chunk.length, data })
        ofs += chunk.length
        remaining -= chunk.length
        if (chunk.length < 90 || remaining === 0) break
      }
      // The stream runs over later ticks; requests meanwhile are dropped.
      this.sending = true
      setTimeout(() => {
        packets.forEach((p, i) => {
          if (p === packets[packets.length - 1]) this.sending = false
          if (i >= this.capacity || this.loseData.delete(p.ofs as number)) return
          this.client.handleMessage('LOG_DATA', p)
        })
      }, 1)
    }
  }

  private entry(id: number, num: number) {
    const size = id ? this.listedSize(id - 1) : 0
    this.client.handleMessage('LOG_ENTRY', {
      id,
      numLogs: num,
      lastLogNum: num,
      timeUtc: 0,
      size,
    })
  }

  sent(msgName: string) {
    return this.received.filter((r) => r.msgName === msgName)
  }
}

function bytes(n: number, seed = 7): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('LogTransferClient listing', () => {
  it('lists every log, oldest first, and ends the transfer', async () => {
    const v = new FakeVehicle([bytes(100), bytes(5000)])
    const done = v.client.list()
    await vi.runAllTimersAsync()
    await expect(done).resolves.toEqual([
      { id: 1, size: 100, timeUtc: 0 },
      { id: 2, size: 5000, timeUtc: 0 },
    ])
    expect(v.sent('LOG_REQUEST_END')).toHaveLength(1)
  })

  it('answers an empty list with no logs', async () => {
    const v = new FakeVehicle([])
    const done = v.client.list()
    await vi.runAllTimersAsync()
    await expect(done).resolves.toEqual([])
  })

  it('asks again for the entries it missed, and only those', async () => {
    const v = new FakeVehicle([bytes(1), bytes(2), bytes(3), bytes(4)])
    v.loseEntries = new Set([2, 3])
    const done = v.client.list()
    await vi.runAllTimersAsync()
    expect((await done).map((e) => e.id)).toEqual([1, 2, 3, 4])
    const asks = v.sent('LOG_REQUEST_LIST')
    expect(asks[1]!.fields).toMatchObject({ start: 2, end: 3 })
  })

  it('gives up on a vehicle that never answers, and still ends the transfer', async () => {
    const v = new FakeVehicle([bytes(10)])
    v.armed = true
    const done = v.client.list()
    const check = expect(done).rejects.toThrow(/timed out/)
    await vi.runAllTimersAsync()
    await check
    expect(v.sent('LOG_REQUEST_END')).toHaveLength(1)
  })
})

describe('LogTransferClient reading', () => {
  it.each([1, 89, 90, 91, 900, 12345])('reads a %i-byte log whole', async (n) => {
    const log = bytes(n)
    const v = new FakeVehicle([log])
    const progress: number[] = []
    const done = v.client.read(1, n, (got) => progress.push(got))
    await vi.runAllTimersAsync()
    expect(await done).toEqual(log)
    expect(progress.at(-1)).toBe(n)
    expect(v.sent('LOG_REQUEST_DATA')).toHaveLength(1)
    expect(v.sent('LOG_REQUEST_END')).toHaveLength(1)
  })

  it('asks for lost packets once the stream has ended', async () => {
    const log = bytes(2000)
    const v = new FakeVehicle([log])
    v.loseData = new Set([180, 270, 900])
    const done = v.client.read(1, log.length)
    await vi.runAllTimersAsync()
    expect(await done).toEqual(log)
    const asks = v.sent('LOG_REQUEST_DATA').map((r) => [r.fields.ofs, r.fields.count])
    expect(asks).toEqual([
      [0, 2000],
      [180, 180],
      [900, 90],
    ])
  })

  it('takes a stream that has gone quiet as ended, without a full stall', async () => {
    // Each stream loses everything past its first six packets, the end
    // included, as a radio's buffer would.
    const log = bytes(9000)
    const v = new FakeVehicle([log])
    v.capacity = 6
    const t0 = Date.now()
    const done = v.client.read(1, log.length)
    await vi.runAllTimersAsync()
    expect(await done).toEqual(log)
    const passes = v.sent('LOG_REQUEST_DATA').length
    expect(passes).toBe(Math.ceil(9000 / 540))
    expect(Date.now() - t0).toBeLessThan(passes * 300)
  })

  it('recovers a lost final packet after a stall', async () => {
    const log = bytes(1000)
    const v = new FakeVehicle([log])
    v.loseData = new Set([990])
    const done = v.client.read(1, log.length)
    await vi.runAllTimersAsync()
    expect(await done).toEqual(log)
  })

  it('stops at a short packet before the listed size', async () => {
    // A block logger's listed size can run past the data it holds.
    const log = bytes(500)
    const v = new FakeVehicle([log], () => 500)
    const done = v.client.read(1, 900)
    await vi.runAllTimersAsync()
    expect(await done).toEqual(log)
  })

  it('cancels with a message the service recognizes, and ends the transfer', async () => {
    const v = new FakeVehicle([bytes(100000)])
    const done = v.client.read(1, 100000)
    const check = expect(done).rejects.toThrow('transfer canceled')
    v.client.cancel()
    await check
    await vi.runAllTimersAsync()
    expect(v.sent('LOG_REQUEST_END')).toHaveLength(1)
  })

  it('refuses a second transfer while one runs', async () => {
    const v = new FakeVehicle([bytes(100)])
    const first = v.client.read(1, 100)
    await expect(v.client.list()).rejects.toThrow(/already running/)
    await vi.runAllTimersAsync()
    expect(await first).toHaveLength(100)
  })
})
