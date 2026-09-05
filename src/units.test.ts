import { describe, expect, it } from 'vitest'
import {
  DISTANCE_CHOICES,
  SPEED_CHOICES,
  distanceLabel,
  formatDistance,
  formatSpeed,
  formatVerticalSpeed,
  fromDistance,
  fromSpeed,
  speedLabel,
  toDistance,
  toSpeed,
  toVerticalSpeed,
  verticalSpeedLabel,
  type DistanceUnit,
  type SpeedUnit,
} from './units'

// The numbers here are the defining ones, not ones this file computed: the
// international foot is exactly 0.3048 m and the nautical mile exactly
// 1852 m, both by treaty. A conversion table checked against its own
// arithmetic proves only that the arithmetic is consistent.

describe('distance', () => {
  it('converts by the international foot, exactly', () => {
    expect(toDistance(0.3048, 'ft')).toBeCloseTo(1, 12)
    expect(toDistance(100, 'ft')).toBeCloseTo(328.0839895, 6)
    expect(toDistance(100, 'm')).toBe(100)
  })

  it('round-trips through the reader and back to metres', () => {
    for (const unit of ['m', 'ft'] as DistanceUnit[]) {
      for (const metres of [0, 1, 3.5, 120, 5280.25, -17]) {
        expect(fromDistance(toDistance(metres, unit), unit)).toBeCloseTo(metres, 10)
      }
    }
  })

  it('labels itself', () => {
    expect(distanceLabel('m')).toBe('m')
    expect(distanceLabel('ft')).toBe('ft')
  })
})

describe('speed', () => {
  it('uses the defined conversions', () => {
    // 1 knot is one nautical mile per hour: 1852 m in 3600 s.
    expect(toSpeed(1852 / 3600, 'kts')).toBeCloseTo(1, 12)
    expect(toSpeed(1, 'kmh')).toBeCloseTo(3.6, 12)
    // 1 m/s is 2.236936... mph, the textbook figure.
    expect(toSpeed(1, 'mph')).toBeCloseTo(2.2369362920544, 10)
    expect(toSpeed(12, 'ms')).toBe(12)
  })

  it('round-trips every unit', () => {
    for (const unit of ['ms', 'kmh', 'kts', 'mph'] as SpeedUnit[]) {
      for (const ms of [0, 1, 12.5, 60, -3]) {
        expect(fromSpeed(toSpeed(ms, unit), unit)).toBeCloseTo(ms, 10)
      }
    }
  })

  it('labels itself', () => {
    expect(speedLabel('ms')).toBe('m/s')
    expect(speedLabel('kts')).toBe('kts')
  })
})

describe('vertical speed', () => {
  it('reads feet per minute wherever distance is in feet', () => {
    // A pilot flying in knots still calls a climb "500 feet a minute", so
    // this follows the distance unit rather than the speed unit.
    expect(toVerticalSpeed(2.54, 'ft')).toBeCloseTo(500, 6)
    expect(verticalSpeedLabel('ft')).toBe('ft/min')
  })

  it('stays metres per second in metric', () => {
    expect(toVerticalSpeed(2.5, 'm')).toBe(2.5)
    expect(verticalSpeedLabel('m')).toBe('m/s')
  })

  it('keeps the sign of a descent', () => {
    expect(toVerticalSpeed(-2.54, 'ft')).toBeCloseTo(-500, 6)
    expect(formatVerticalSpeed(-2.54, 'ft')).toBe('-500')
  })
})

describe('formatting', () => {
  it('drops a decimal in the coarser unit', () => {
    // A foot is a third of a metre: the same decimals would show finer
    // precision than the number behind them has.
    expect(formatDistance(52.3, 'm')).toBe('52.3')
    expect(formatDistance(52.3, 'ft')).toBe('172')
    expect(formatSpeed(12.34, 'ms')).toBe('12.3')
    expect(formatSpeed(12.34, 'kts')).toBe('24')
  })

  it('drops the decimal on large distances, where it is noise', () => {
    expect(formatDistance(1234.5, 'm')).toBe('1235')
    expect(formatDistance(99.9, 'm')).toBe('99.9')
  })

  it('takes an explicit precision when a caller needs one', () => {
    expect(formatDistance(52.3456, 'm', 3)).toBe('52.346')
    expect(formatSpeed(12.3456, 'kts', 2)).toBe('24.00')
  })
})

describe('the choices a preferences control offers', () => {
  it('covers every unit the converters accept', () => {
    for (const c of DISTANCE_CHOICES) expect(distanceLabel(c.id)).toBeTruthy()
    for (const c of SPEED_CHOICES) expect(speedLabel(c.id)).toBeTruthy()
    expect(DISTANCE_CHOICES.map((c) => c.id)).toEqual(['m', 'ft'])
    expect(SPEED_CHOICES).toHaveLength(4)
  })
})
