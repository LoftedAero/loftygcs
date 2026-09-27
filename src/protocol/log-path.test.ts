import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseDataflash, type MessageTable, type ParsedLog } from './dataflash'
import { flightPath, sampleAt } from './log-path'

const real = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

/** A log with exactly the position and attitude records a test needs. */
function logWith(
  position: { message: string; time: number[]; lat: number[]; lon: number[]; alt: number[] },
  attitude?: { time: number[]; roll: number[]; pitch: number[]; yaw: number[] },
): ParsedLog {
  const table = (name: string, cols: Record<string, number[]>): [string, MessageTable] => [
    name,
    {
      format: {
        type: 1,
        name,
        length: 0,
        fields: Object.keys(cols).map((f) => ({ name: f, format: 'f' })),
      },
      count: Object.values(cols)[0]!.length,
      columns: new Map(Object.entries(cols).map(([k, v]) => [k, Float64Array.from(v)])),
    },
  ]
  const messages = new Map<string, MessageTable>([
    table(position.message, {
      TimeUS: position.time,
      Lat: position.lat,
      Lng: position.lon,
      Alt: position.alt,
    }),
  ])
  if (attitude) {
    messages.set(
      'ATT',
      table('ATT', {
        TimeUS: attitude.time,
        Roll: attitude.roll,
        Pitch: attitude.pitch,
        Yaw: attitude.yaw,
      })[1],
    )
  }
  return { messages, params: new Map(), problems: [], skippedBytes: 0 }
}

describe('reading a path out of a real log', () => {
  it('prefers the EKF position and joins attitude onto it', () => {
    const path = flightPath(real)
    expect(path.source).toBe('POS')
    expect(path.hasAttitude).toBe(true)
    expect(path.samples.length).toBeGreaterThan(0)
    expect(path.problems).toEqual([])
  })

  it('produces degrees and meters, not raw log units', () => {
    const first = flightPath(real).samples[0]!
    // Canberra, and the field elevation there.
    expect(first.lat).toBeCloseTo(-35.36, 1)
    expect(first.lon).toBeCloseTo(149.17, 1)
    expect(first.alt).toBeGreaterThan(500)
    expect(first.alt).toBeLessThan(700)
  })

  it('finds the sample at a moment, and clamps outside the flight', () => {
    const path = flightPath(real)
    const mid = path.samples[Math.floor(path.samples.length / 2)]!
    expect(sampleAt(path, mid.time)!.time).toBe(mid.time)
    expect(sampleAt(path, -1)).toBe(path.samples[0])
    expect(sampleAt(path, 1e9)).toBe(path.samples[path.samples.length - 1])
  })
})

describe('joining position to attitude', () => {
  it('samples attitude onto each position timestamp', () => {
    const path = flightPath(
      logWith(
        { message: 'POS', time: [0, 1, 2], lat: [1, 1, 1], lon: [2, 2, 2], alt: [10, 20, 30] },
        { time: [0, 2], roll: [0, 20], pitch: [0, -10], yaw: [0, 0] },
      ),
    )
    // The position at t=1 falls halfway between the two attitude records.
    expect(path.samples[1]!.roll).toBeCloseTo(10, 6)
    expect(path.samples[1]!.pitch).toBeCloseTo(-5, 6)
  })

  it('turns a heading the short way round', () => {
    // A plain average of 359 and 1 is 180: a half turn every time it flies
    // north.
    const path = flightPath(
      logWith(
        { message: 'POS', time: [0, 1, 2], lat: [1, 1, 1], lon: [2, 2, 2], alt: [0, 0, 0] },
        { time: [0, 2], roll: [0, 0], pitch: [0, 0], yaw: [359, 1] },
      ),
    )
    expect(path.samples[1]!.yaw).toBeCloseTo(0, 6)
  })

  it('turns the short way in the other direction too', () => {
    const path = flightPath(
      logWith(
        { message: 'POS', time: [0, 1, 2], lat: [1, 1, 1], lon: [2, 2, 2], alt: [0, 0, 0] },
        { time: [0, 2], roll: [0, 0], pitch: [0, 0], yaw: [10, 350] },
      ),
    )
    expect(path.samples[1]!.yaw).toBeCloseTo(0, 6)
  })

  it('flies level, and says so, when the log has no attitude', () => {
    const path = flightPath(
      logWith({ message: 'POS', time: [0, 1], lat: [1, 1], lon: [2, 2], alt: [0, 5] }),
    )
    expect(path.hasAttitude).toBe(false)
    expect(path.samples.every((s) => s.roll === 0 && s.yaw === 0)).toBe(true)
    expect(path.problems.join(' ')).toMatch(/flies level/)
  })
})

describe('choosing a position source', () => {
  it('falls back to AHR2, then to GPS', () => {
    expect(
      flightPath(logWith({ message: 'AHR2', time: [0], lat: [1], lon: [2], alt: [3] })).source,
    ).toBe('AHR2')
    expect(
      flightPath(logWith({ message: 'GPS', time: [0], lat: [1], lon: [2], alt: [3] })).source,
    ).toBe('GPS')
  })

  it('drops the records logged before the EKF had a fix', () => {
    // Pre-fix records sit at 0,0, which would drag the track across the
    // Atlantic.
    const path = flightPath(
      logWith({
        message: 'POS',
        time: [0, 1, 2],
        lat: [0, 0, 51],
        lon: [0, 0, -1],
        alt: [0, 0, 5],
      }),
    )
    expect(path.samples).toHaveLength(1)
    expect(path.samples[0]!.lat).toBe(51)
  })

  it('says so rather than throwing when there is no position at all', () => {
    const empty: ParsedLog = {
      messages: new Map(),
      params: new Map(),
      problems: [],
      skippedBytes: 0,
    }
    const path = flightPath(empty)
    expect(path.samples).toEqual([])
    expect(path.source).toBeNull()
    expect(path.problems.join(' ')).toMatch(/No position/)
    expect(sampleAt(path, 5)).toBeNull()
  })
})

describe('altitude, and what a globe with no terrain needs', () => {
  it('keeps AMSL and offers height above the launch point', () => {
    const path = flightPath(real)
    const first = path.samples[0]!
    // The field is nearly 600 m up; the aircraft started on it.
    expect(first.alt).toBeGreaterThan(500)
    expect(Math.abs(first.altAboveHome)).toBeLessThan(2)
    expect(path.groundAlt).toBeGreaterThan(500)
  })

  it('prefers the relative altitude the log recorded', () => {
    // POS carries RelHomeAlt; the vehicle's own number is preferred.
    const path = flightPath(real)
    for (const s of path.samples) {
      expect(s.altAboveHome).toBeCloseTo(s.alt - path.groundAlt!, 0)
    }
  })

  it('subtracts the ground when the source has no relative field', () => {
    // AHR2 and GPS report AMSL only. On a globe with no terrain, a track at a
    // field 584 m up would float 584 m over the rendered ground.
    const path = flightPath(
      logWith({ message: 'AHR2', time: [0, 1], lat: [51, 51], lon: [-1, -1], alt: [584, 599] }),
    )
    expect(path.groundAlt).toBe(584)
    expect(path.samples.map((s) => s.altAboveHome)).toEqual([0, 15])
  })
})
