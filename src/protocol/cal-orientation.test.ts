import { describe, expect, it } from 'vitest'
import { ORIENTATIONS, downInBody, orientationFor, verticalRate } from './cal-orientation'

const deg = (d: number) => (d * Math.PI) / 180

// Each attitude is checked against what defines it: where earth's "down"
// points in body frame.

describe('recognising the six calibration attitudes', () => {
  it('puts down along +Z when the vehicle is level', () => {
    const g = downInBody(0, 0)
    expect(g[0]).toBeCloseTo(0, 6)
    expect(g[1]).toBeCloseTo(0, 6)
    expect(g[2]).toBeCloseTo(1, 6)
    expect(orientationFor(0, 0)).toBe('level')
  })

  it('recognises each attitude from its own roll and pitch', () => {
    // MAVLink body frame: X forward, Y right, Z down. Positive pitch is nose
    // up, so nose *down* is negative pitch; positive roll puts the right side
    // down.
    expect(orientationFor(0, deg(-90))).toBe('noseDown')
    expect(orientationFor(0, deg(90))).toBe('tailDown')
    expect(orientationFor(deg(90), 0)).toBe('rightSide')
    expect(orientationFor(deg(-90), 0)).toBe('leftSide')
    expect(orientationFor(deg(180), 0)).toBe('upsideDown')
  })

  it('covers all six, so none of the tiles is unreachable', () => {
    const found = new Set(
      [
        orientationFor(0, 0),
        orientationFor(0, deg(-90)),
        orientationFor(0, deg(90)),
        orientationFor(deg(90), 0),
        orientationFor(deg(-90), 0),
        orientationFor(deg(180), 0),
      ].filter(Boolean),
    )
    expect(found.size).toBe(ORIENTATIONS.length)
  })

  it('says nothing when the vehicle is between attitudes', () => {
    // Claiming either would count turns against the wrong tile.
    expect(orientationFor(deg(45), 0)).toBeNull()
    expect(orientationFor(0, deg(45))).toBeNull()
  })

  it('tolerates a hand-held vehicle that is not quite square', () => {
    expect(orientationFor(deg(20), deg(15))).toBe('level')
    expect(orientationFor(deg(-75), 0)).toBe('leftSide')
  })
})

describe('measuring the turn about earth vertical', () => {
  it('reads yaw rate directly when the vehicle is level', () => {
    const r = verticalRate(0, 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: 1.5 })
    expect(r).toBeCloseTo(1.5, 6)
  })

  it('reads *roll* rate when the vehicle is nose down', () => {
    // At pitch -90 body X points at the ground, so spinning about vertical
    // shows up as roll rate, and Euler yaw is degenerate. Hence a projection
    // rather than yaw.
    const r = verticalRate(0, deg(-90), { rollRateRad: 1.2, pitchRateRad: 0, yawRateRad: 0 })
    expect(r).toBeCloseTo(1.2, 5)
  })

  it('reads pitch rate when the vehicle is on its side', () => {
    const r = verticalRate(deg(90), 0, { rollRateRad: 0, pitchRateRad: 0.8, yawRateRad: 0 })
    expect(r).toBeCloseTo(0.8, 5)
  })

  it('ignores rotation that is not about vertical', () => {
    // Level, tipping nose up and down: no progress around vertical.
    const r = verticalRate(0, 0, { rollRateRad: 2, pitchRateRad: 2, yawRateRad: 0 })
    expect(r).toBeCloseTo(0, 6)
  })

  it('counts a turn either way round', () => {
    const cw = verticalRate(0, 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: 1 })
    const ccw = verticalRate(0, 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: -1 })
    expect(cw).toBeCloseTo(ccw, 9)
  })

  it('is upside down without going negative', () => {
    const r = verticalRate(deg(180), 0, { rollRateRad: 0, pitchRateRad: 0, yawRateRad: 1 })
    expect(r).toBeCloseTo(1, 5)
  })
})
