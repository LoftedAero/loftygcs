import { describe, expect, it } from 'vitest'
import { describeCopy, describeOutcome } from './OfflineMapsPanel'
import type { PrefetchProgress } from '../../../services/tile-cache'

// The message comes from what the download reports, not what was requested,
// so a dead network does not produce a success message.

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

describe('describeCopy', () => {
  it('says what a copy did', () => {
    expect(describeCopy({ written: 1234, missing: 0 }, 'EdgeTX')).toBe(
      'Copied 1,234 tiles to the EdgeTX radio.',
    )
    expect(describeCopy({ written: 10, missing: 2 }, 'Ethos')).toBe(
      'Copied 10 tiles · 2 unavailable.',
    )
    expect(describeCopy(null, 'Ethos')).toBe('The card could not be written.')
  })
})
