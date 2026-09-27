import { describe, expect, it } from 'vitest'
import { collectFields, fieldName } from './fields'
import type { DecodedMessage } from './types'

const msg = (msgName: string, fields: DecodedMessage['fields']): DecodedMessage => ({
  sysid: 1,
  compid: 1,
  msgid: 0,
  seq: 0,
  msgName,
  fields,
})

describe('collectFields', () => {
  it('qualifies field names by message', () => {
    // ATTITUDE.roll and AHRS2.roll are different numbers from different
    // estimators; an unqualified "roll" would silently overwrite one.
    const into = new Map<string, number>()
    collectFields(msg('ATTITUDE', { roll: 0.1 }), into)
    collectFields(msg('AHRS2', { roll: 0.2 }), into)
    expect(into.get('ATTITUDE.roll')).toBe(0.1)
    expect(into.get('AHRS2.roll')).toBe(0.2)
  })

  it('keeps the newest value for a field', () => {
    const into = new Map<string, number>()
    collectFields(msg('VFR_HUD', { airspeed: 12 }), into)
    collectFields(msg('VFR_HUD', { airspeed: 14 }), into)
    expect(into.get('VFR_HUD.airspeed')).toBe(14)
  })

  it('skips values that are not finite numbers', () => {
    // Strings, arrays and bigints all appear in real messages. Coercing them
    // produces NaN entries that then have to be filtered at every read.
    const into = new Map<string, number>()
    collectFields(
      msg('X', {
        good: 1,
        text: 'hello',
        list: [1, 2, 3],
        big: 10n,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
      } as unknown as DecodedMessage['fields']),
      into,
    )
    expect([...into.keys()]).toEqual(['X.good'])
  })

  it('leaves out addressing fields', () => {
    // They are identical on every packet of a link.
    const into = new Map<string, number>()
    collectFields(msg('X', { targetSystem: 1, targetComponent: 1, real: 42 }), into)
    expect([...into.keys()]).toEqual(['X.real'])
  })

  it('keeps a message field called seq, which is not the packet counter', () => {
    // A mission item's seq is payload, not the frame's sequence number.
    const into = new Map<string, number>()
    collectFields(msg('MISSION_CURRENT', { seq: 3 }), into)
    expect(into.get('MISSION_CURRENT.seq')).toBe(3)
  })

  it('accumulates across many messages without dropping any', () => {
    const into = new Map<string, number>()
    collectFields(msg('A', { x: 1, y: 2 }), into)
    collectFields(msg('B', { x: 3 }), into)
    expect([...into.keys()].sort()).toEqual(['A.x', 'A.y', 'B.x'])
  })

  it('names fields the way the registry keys them', () => {
    expect(fieldName('GPS_RAW_INT', 'satellitesVisible')).toBe('GPS_RAW_INT.satellitesVisible')
  })
})
