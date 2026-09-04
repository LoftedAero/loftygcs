import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseDataflash, type ParsedLog } from './dataflash'
import { firmwareString, logEnd, modeSpans, vehicleClassFromLog } from './log-modes'

const log = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

/**
 * A log with the MODE history I want to test against.
 *
 * The real fixture is a slice of one flight and holds a single mode, so the
 * contiguity and merging rules would pass on it no matter what they did.
 */
function logWithModes(times: number[], modes: number[], end = 100): ParsedLog {
  const columns = new Map<string, Float64Array | string[]>([
    ['TimeUS', Float64Array.from(times)],
    ['Mode', Float64Array.from(modes)],
  ])
  const fields = [
    { name: 'TimeUS', format: 'Q' },
    { name: 'Mode', format: 'M' },
  ]
  const messages = new Map([
    [
      'MODE',
      { format: { type: 1, name: 'MODE', length: 0, fields }, count: times.length, columns },
    ],
    [
      'VER',
      {
        format: { type: 2, name: 'VER', length: 0, fields: [{ name: 'FWS', format: 'Z' }] },
        count: 1,
        columns: new Map<string, Float64Array | string[]>([['FWS', ['ArduCopter V4.7.1']]]),
      },
    ],
    [
      'ATT',
      {
        format: { type: 3, name: 'ATT', length: 0, fields: [{ name: 'TimeUS', format: 'Q' }] },
        count: 1,
        columns: new Map<string, Float64Array | string[]>([['TimeUS', Float64Array.from([end])]]),
      },
    ],
  ])
  return { messages, params: new Map(), problems: [], skippedBytes: 0 }
}

describe('working out what flew', () => {
  it('reads the firmware banner the log carries', () => {
    expect(firmwareString(log)).toMatch(/ArduCopter/)
  })

  it('names the vehicle family from it, not from a parameter', () => {
    // FRAME_CLASS exists on a plane too and a quadplane has both, so the
    // banner is the only unambiguous statement in the file.
    expect(vehicleClassFromLog(log)).toBe('copter')
  })

  it('says "other" rather than guessing when there is no banner', () => {
    const empty: ParsedLog = {
      messages: new Map(),
      params: new Map(),
      problems: [],
      skippedBytes: 0,
    }
    expect(vehicleClassFromLog(empty)).toBe('other')
    expect(modeSpans(empty)).toEqual([])
  })
})

describe('flight mode spans', () => {
  it('reads them out of a real log', () => {
    const spans = modeSpans(log)
    expect(spans.length).toBeGreaterThan(0)
    // Copter mode 5, named for the vehicle the banner identified.
    expect(spans[0]!.name).toBe('Loiter')
  })

  it('turns mode changes into contiguous stretches', () => {
    const spans = modeSpans(logWithModes([0, 10, 25], [0, 4, 3], 60))
    expect(spans.map((s) => s.name)).toEqual(['Stabilize', 'Guided', 'Auto'])
    expect(spans.map((s) => [s.from, s.to])).toEqual([
      [0, 10],
      [10, 25],
      [25, 60],
    ])
  })

  it('runs the last span to the end of the log, not to the last change', () => {
    // Ending at the final MODE record would leave the most interesting part
    // of most flights unshaded: the vehicle stayed in that mode until the
    // recording stopped.
    const spans = modeSpans(logWithModes([0, 10], [0, 4], 300))
    expect(spans[spans.length - 1]!.to).toBe(300)
  })

  it('merges a mode logged twice running into one span', () => {
    // ArduPilot re-records the current mode for reasons of its own, and two
    // touching bands of the same name would read as a mode change.
    const spans = modeSpans(logWithModes([0, 10, 20, 30], [0, 4, 4, 3], 40))
    expect(spans.map((s) => s.name)).toEqual(['Stabilize', 'Guided', 'Auto'])
    expect(spans[1]).toMatchObject({ from: 10, to: 30 })
  })

  it('names modes for the vehicle that flew, not for a copter always', () => {
    // Auto is 3 on Copter and 10 on Plane; a shared table would mislabel
    // half the logs this app opens.
    const plane = logWithModes([0], [10], 20)
    plane.messages.get('VER')!.columns.set('FWS', ['ArduPlane V4.7.1'])
    expect(vehicleClassFromLog(plane)).toBe('plane')
    expect(modeSpans(plane)[0]!.name).toBe('Auto')
  })

  it('finds the end of the log across every message, not just MODE', () => {
    expect(logEnd(logWithModes([0], [0], 123))).toBe(123)
  })
})
