import { beforeEach, describe, expect, it } from 'vitest'
import { fieldRegistry } from './telemetry-fields'

describe('fieldRegistry', () => {
  beforeEach(() => fieldRegistry.clear())

  it('learns field names as they arrive', () => {
    expect(fieldRegistry.names()).toEqual([])
    fieldRegistry.apply(1000, { 'VFR_HUD.airspeed': 12 })
    fieldRegistry.apply(1100, { 'VFR_HUD.airspeed': 13, 'ATTITUDE.roll': 0.2 })
    expect(fieldRegistry.names()).toEqual(['ATTITUDE.roll', 'VFR_HUD.airspeed'])
  })

  it('sorts names so the list does not reshuffle as fields appear', () => {
    fieldRegistry.apply(1, { 'Z.a': 1, 'A.b': 2, 'M.c': 3 })
    expect(fieldRegistry.names()).toEqual(['A.b', 'M.c', 'Z.a'])
  })

  it('keeps the latest value', () => {
    fieldRegistry.apply(1000, { 'X.v': 1 })
    fieldRegistry.apply(1100, { 'X.v': 2 })
    expect(fieldRegistry.latest('X.v')).toBe(2)
  })

  it('reports nothing for a field never seen', () => {
    expect(fieldRegistry.latest('nope')).toBeUndefined()
    expect(fieldRegistry.samples('nope')).toBeUndefined()
    expect(fieldRegistry.has('nope')).toBe(false)
  })

  it('returns samples oldest first, with their times', () => {
    fieldRegistry.apply(1000, { 'X.v': 10 })
    fieldRegistry.apply(1100, { 'X.v': 20 })
    fieldRegistry.apply(1200, { 'X.v': 30 })
    const s = fieldRegistry.samples('X.v')!
    expect([...s.t]).toEqual([1000, 1100, 1200])
    expect([...s.v]).toEqual([10, 20, 30])
  })

  it('rolls old samples off once the buffer wraps, keeping order', () => {
    // The plot walks these front to back, so they must come out in time order.
    for (let i = 0; i < 1000; i++) fieldRegistry.apply(i, { 'X.v': i })
    const s = fieldRegistry.samples('X.v')!
    expect(s.t.length).toBe(900)
    expect(s.t[0]).toBe(100)
    expect(s.t[899]).toBe(999)
    for (let i = 1; i < s.t.length; i++) {
      expect(s.t[i]!).toBeGreaterThan(s.t[i - 1]!)
    }
  })

  it('only bumps its version when a name is new', () => {
    // The status list rebuilds its name array whenever this changes.
    fieldRegistry.apply(1, { 'X.v': 1 })
    const after = fieldRegistry.version()
    fieldRegistry.apply(2, { 'X.v': 2 })
    expect(fieldRegistry.version()).toBe(after)
    fieldRegistry.apply(3, { 'Y.v': 1 })
    expect(fieldRegistry.version()).toBeGreaterThan(after)
  })

  it('forgets everything when the vehicle goes away', () => {
    // Otherwise the next vehicle would inherit the last one's fields.
    fieldRegistry.apply(1, { 'X.v': 1 })
    fieldRegistry.clear()
    expect(fieldRegistry.names()).toEqual([])
    expect(fieldRegistry.latest('X.v')).toBeUndefined()
  })
})
