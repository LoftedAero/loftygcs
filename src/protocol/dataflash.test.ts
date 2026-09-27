import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  parseDataflash,
  getSeries,
  plottableFields,
  seriesStats,
  HEAD1,
  HEAD2,
} from './dataflash'

// Tested against a real ArduCopter SITL log rather than one this code wrote,
// since a parser checked against its own encoder only confirms its own
// assumptions (such as double-applied scaling, or a multiplier table whose
// "none" entry is zero).
//
// The fixture is the first 192 KiB of a flight log: real FMT/FMTU/UNIT/MULT
// tables, a 1370-parameter dump, and telemetry from a copter that took off at
// Canberra. A prefix of a dataflash log is still a valid log.

const log = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

describe('reading a real ArduPilot log', () => {
  it('parses it cleanly', () => {
    expect(log.problems).toEqual([])
    expect(log.skippedBytes).toBe(0)
    expect(log.messages.size).toBeGreaterThan(50)
  })

  it('learns message shapes it was never told about', () => {
    // Nothing here knows what an XKF1 is; FMT does.
    const xkf = log.messages.get('XKF1')
    expect(xkf).toBeDefined()
    expect(xkf!.format.fields.map((f) => f.name)).toContain('Roll')
  })

  it('recovers the vehicle parameters the log carries', () => {
    expect(log.params.size).toBeGreaterThan(1000)
    // PARM grew a Default column in 4.x, so Name and Value are found by
    // label rather than by position.
    expect(log.params.get('SERVO1_FUNCTION')).toBe(33)
    expect(log.params.get('RCMAP_ROLL')).toBe(1)
  })
})

describe('units and scaling', () => {
  it('labels fields from the log’s own unit table', () => {
    const imu = log.messages.get('IMU')!
    const accZ = imu.format.fields.find((f) => f.name === 'AccZ')
    expect(accZ!.unit).toBe('m/s/s')
    const rcou = log.messages.get('RCOU')!
    expect(rcou.format.fields.find((f) => f.name === 'C1')!.unit).toBe('us')
  })

  it('treats the firmware’s "UNKNOWN" as no unit at all', () => {
    // SIM2's fields are genuinely unitless and the log says so in words.
    const sim = log.messages.get('SIM2')
    if (!sim) return
    expect(sim.format.fields.find((f) => f.name === 'PN')?.unit ?? '').toBe('')
  })

  it('scales a scaled-integer field exactly once', () => {
    // ORGN is the EKF origin; this vehicle booted at Canberra, 584.09 m.
    // Format char 'e' says "int32 * 100" and MULT says 0.01 for the same
    // field; applying both gives 5.84 m.
    const origin = log.messages.get('ORGN')!
    expect((origin.columns.get('Alt') as Float64Array)[0]).toBeCloseTo(584.09, 2)
  })

  it('decodes coordinates to exact degrees', () => {
    // The multiplier is float32 in the file (1.0000000116860974e-7), which
    // leaves a millimeter of error on every latitude unless snapped.
    const origin = log.messages.get('ORGN')!
    expect((origin.columns.get('Lat') as Float64Array)[0]).toBe(-35.363262)
    expect((origin.columns.get('Lng') as Float64Array)[0]).toBe(149.165237)
  })

  it('puts gravity where it belongs, which no amount of unit metadata proves', () => {
    // A stationary copter's Z accelerometer reads about -9.8 m/s^2. Wrong
    // scaling anywhere upstream moves this.
    const accZ = getSeries(log, 'IMU', 'AccZ')!
    const mean = accZ.values.reduce((a, b) => a + b, 0) / accZ.values.length
    expect(mean).toBeLessThan(-9)
    expect(mean).toBeGreaterThan(-11)
  })
})

describe('series for plotting', () => {
  it('hands back a time base in seconds, not microseconds', () => {
    const roll = getSeries(log, 'ATT', 'Roll')!
    expect(roll.time.length).toBe(roll.values.length)
    // A short log slice: tens of seconds since boot, not tens of millions.
    expect(roll.time[roll.time.length - 1]).toBeLessThan(1000)
    expect(roll.time[roll.time.length - 1]).toBeGreaterThan(roll.time[0]!)
    expect(roll.unit).toBe('deg')
  })

  it('offers every numeric field of every timestamped message', () => {
    const fields = plottableFields(log)
    expect(fields.length).toBeGreaterThan(300)
    // Never the time base itself, and never a text column.
    expect(fields.some((f) => f.field === 'TimeUS')).toBe(false)
    expect(fields.some((f) => f.message === 'PARM' && f.field === 'Name')).toBe(false)
    expect(fields).toContainEqual({ message: 'ATT', field: 'Roll', unit: 'deg' })
  })

  it('declines a field that has no time to plot against', () => {
    expect(getSeries(log, 'ATT', 'NotAField')).toBeNull()
    expect(getSeries(log, 'NoSuchMessage', 'Roll')).toBeNull()
  })
})

describe('surviving a damaged file', () => {
  it('reads a log that stops mid-message', () => {
    // As a log pulled off a card mid-write does.
    const bytes = new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz')))
    const cut = parseDataflash(bytes.subarray(0, bytes.length - 7))
    expect(cut.messages.size).toBe(log.messages.size)
    expect(cut.problems).toEqual([])
  })

  it('reports garbage rather than throwing on it', () => {
    const junk = new Uint8Array(512)
    junk.fill(0x42)
    const parsed = parseDataflash(junk)
    expect(parsed.messages.size).toBe(0)
    expect(parsed.problems.join(' ')).toMatch(/does not look like a dataflash log/)
  })

  it('picks the stream back up after a corrupt stretch', () => {
    const good = new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz')))
    const damaged = new Uint8Array(good.length + 64)
    damaged.set(good.subarray(0, 40000), 0)
    damaged.fill(0x00, 40000, 40064) // 64 bytes of nothing, mid-file
    damaged.set(good.subarray(40000), 40064)
    const parsed = parseDataflash(damaged)
    expect(parsed.skippedBytes).toBeGreaterThan(0)
    expect(parsed.problems.join(' ')).toMatch(/did not belong/)
    // It kept going and still knows about the whole log.
    expect(parsed.messages.size).toBe(log.messages.size)
  })

  it('knows a header when it sees one', () => {
    expect(HEAD1).toBe(0xa3)
    expect(HEAD2).toBe(0x95)
  })
})

describe('summarizing a trace', () => {
  it('reports min, max and mean over a window', () => {
    const roll = getSeries(log, 'ATT', 'Roll')!
    const all = seriesStats(roll, 0, 1e9)
    expect(all.count).toBe(roll.values.length)
    expect(all.min).toBeLessThanOrEqual(all.mean)
    expect(all.mean).toBeLessThanOrEqual(all.max)
    // Gravity again, as an arithmetic check.
    const accZ = seriesStats(getSeries(log, 'IMU', 'AccZ')!, 0, 1e9)
    expect(accZ.mean).toBeGreaterThan(-11)
    expect(accZ.mean).toBeLessThan(-9)
  })

  it('summarizes only what is inside the window', () => {
    const roll = getSeries(log, 'ATT', 'Roll')!
    const mid = (roll.time[0]! + roll.time[roll.time.length - 1]!) / 2
    const first = seriesStats(roll, roll.time[0]!, mid)
    const second = seriesStats(roll, mid, roll.time[roll.time.length - 1]!)
    const all = seriesStats(roll, 0, 1e9)
    expect(first.count + second.count).toBeGreaterThanOrEqual(all.count)
    expect(first.count).toBeGreaterThan(0)
    expect(second.count).toBeGreaterThan(0)
    expect(Math.min(first.min, second.min)).toBe(all.min)
    expect(Math.max(first.max, second.max)).toBe(all.max)
  })

  it('says nothing rather than NaN when the window holds no samples', () => {
    const roll = getSeries(log, 'ATT', 'Roll')!
    expect(seriesStats(roll, 1e8, 1e9)).toEqual({ min: 0, max: 0, mean: 0, count: 0 })
  })
})
