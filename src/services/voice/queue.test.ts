import { describe, expect, it } from 'vitest'
import { AnnounceQueue, type QueueItem } from './queue'

/** Sinks that record what played and finish only when told to. */
function harness() {
  let now = 0
  const played: string[] = []
  const stops: number[] = []
  let finish: (() => void) | null = null
  const q = new AnnounceQueue(
    {
      speak: (text) => {
        played.push(text)
        return new Promise<void>((r) => (finish = r))
      },
      beep: (kind) => {
        played.push(`beep:${kind}`)
        return new Promise<void>((r) => (finish = r))
      },
      stop: () => {
        stops.push(now)
        finish?.()
      },
    },
    () => now,
  )
  const item = (text: string | null, pri: QueueItem['pri'], key = text ?? 'b'): QueueItem => ({
    text,
    beep: 'info',
    pri,
    key,
    at: now,
  })
  const done = async () => {
    const f = finish
    finish = null
    f?.()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { q, played, stops, item, done, advance: (ms: number) => (now += ms) }
}

describe('the callout queue', () => {
  it('plays one at a time, most urgent first', async () => {
    const h = harness()
    h.q.push(h.item('first', 'info'))
    h.q.push(h.item('later info', 'info'))
    h.q.push(h.item('a warning', 'warn'))
    expect(h.played).toEqual(['first'])
    await h.done()
    expect(h.played).toEqual(['first', 'a warning'])
    await h.done()
    expect(h.played).toEqual(['first', 'a warning', 'later info'])
  })

  it('lets a critical alert cut off anything less', async () => {
    const h = harness()
    h.q.push(h.item('waypoint 4', 'info'))
    h.q.push(h.item('telemetry lost', 'crit'))
    expect(h.stops).toHaveLength(1)
    await Promise.resolve()
    expect(h.played).toEqual(['waypoint 4', 'telemetry lost'])
  })

  it('does not cut off one critical alert for another', async () => {
    const h = harness()
    h.q.push(h.item('battery critical', 'crit'))
    h.q.push(h.item('fence breached', 'crit'))
    expect(h.stops).toHaveLength(0)
    await h.done()
    expect(h.played).toEqual(['battery critical', 'fence breached'])
  })

  it('drops information that has waited too long rather than say it late', async () => {
    const h = harness()
    h.q.push(h.item('long phrase', 'warn'))
    h.q.push(h.item('waypoint 2', 'info'))
    h.advance(6000)
    await h.done()
    expect(h.played).toEqual(['long phrase'])
  })

  it('keeps one copy of a callout that is already waiting or just played', async () => {
    const h = harness()
    h.q.push(h.item('playing', 'info'))
    h.q.push(h.item(null, 'warn', 'ekf'))
    h.q.push(h.item(null, 'warn', 'ekf'))
    expect(h.q.pending).toHaveLength(1)
    await h.done()
    h.q.push(h.item(null, 'warn', 'ekf'))
    expect(h.q.pending).toHaveLength(0)
  })

  it('stays short, dropping the least urgent first', () => {
    const h = harness()
    h.q.push(h.item('playing', 'crit'))
    for (let i = 0; i < 5; i++) h.q.push(h.item(`info ${i}`, 'info'))
    h.q.push(h.item('warn 1', 'warn'))
    h.q.push(h.item('warn 2', 'warn'))
    expect(h.q.pending.map((i) => i.text)).toEqual([
      'warn 1',
      'warn 2',
      'info 1',
      'info 2',
      'info 3',
      'info 4',
    ])
  })

  it('goes quiet when cleared', async () => {
    const h = harness()
    h.q.push(h.item('one', 'info'))
    h.q.push(h.item('two', 'info'))
    h.q.clear()
    await Promise.resolve()
    expect(h.stops).toHaveLength(1)
    expect(h.played).toEqual(['one'])
    expect(h.q.current).toBeNull()
  })
})
