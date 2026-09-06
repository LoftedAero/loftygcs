import { describe, expect, it } from 'vitest'
import { describeOutcome } from './OfflineMapsPanel'
import type { PrefetchProgress } from '../../../services/tile-cache'

// The message is composed from what the download reports, never from what it
// was asked for -- the first version said "Stored N map tiles" from the
// request, which on a dead network was a success message over a cache that
// had gained nothing.

const run = (done: number, failed = 0, cached = 0): PrefetchProgress => ({
  done,
  total: done,
  failed,
  cached,
})

describe('what the download says it did', () => {
  it('reports what was stored, not what was asked for', () => {
    expect(describeOutcome(run(10), run(2))).toBe('Stored 12 tiles.')
  })

  it('does not claim success over a dead network', () => {
    expect(describeOutcome(run(10, 10), null)).toBe('10 tiles unavailable.')
  })

  it('says both when a download was partial', () => {
    expect(describeOutcome(run(10, 3), null)).toBe('Stored 7 · 3 unavailable.')
  })

  it('says so when everything was already there', () => {
    expect(describeOutcome(run(10, 0, 10), run(1, 0, 1))).toBe('Everything here is already stored.')
  })
})
