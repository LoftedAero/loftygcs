import { describe, expect, it } from 'vitest'
import { RttEstimator } from './link-timing'

describe('RttEstimator', () => {
  it('keeps the caller floor until something is measured', () => {
    const r = new RttEstimator()
    expect(r.rttMs).toBeNull()
    expect(r.timeout(1500)).toBe(1500)
  })

  it('keeps the floor on a fast link', () => {
    const r = new RttEstimator()
    for (let i = 0; i < 20; i++) r.sample(15)
    expect(r.timeout(1500)).toBe(1500)
  })

  it('grows past the floor on a slow link', () => {
    const r = new RttEstimator()
    for (const ms of [2400, 2600, 2500, 3300, 2500]) r.sample(ms)
    expect(r.rttMs).toBeGreaterThan(2000)
    expect(r.timeout(1500)).toBeGreaterThan(3000)
  })

  it('caps the timeout', () => {
    const r = new RttEstimator()
    r.sample(60000)
    expect(r.timeout(500)).toBe(10000)
  })

  it('ignores nonsense samples', () => {
    const r = new RttEstimator()
    r.sample(-5)
    r.sample(Number.NaN)
    expect(r.rttMs).toBeNull()
  })
})
