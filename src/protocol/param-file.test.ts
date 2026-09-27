import { describe, expect, it } from 'vitest'
import {
  compareParams,
  parseParamFile,
  sameValue,
  serializeParamFile,
  summarize,
} from './param-file'

const current = new Map([
  ['ANGLE_MAX', { value: 3000 }],
  ['ARMING_CHECK', { value: 1 }],
  ['ATC_ANG_PIT_P', { value: 4.5 }],
])

describe('parseParamFile', () => {
  it('reads what Mission Planner writes', () => {
    const { entries, skipped } = parseParamFile(
      '#NOTE: written by Mission Planner\r\nANGLE_MAX,4500\r\nARMING_CHECK,0\r\n',
    )
    expect(entries).toEqual([
      { name: 'ANGLE_MAX', value: 4500 },
      { name: 'ARMING_CHECK', value: 0 },
    ])
    expect(skipped).toEqual([])
  })

  it('accepts tabs and spaces, which the format has collected over the years', () => {
    const { entries } = parseParamFile('ANGLE_MAX\t4500\nARMING_CHECK 0\n')
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({ name: 'ARMING_CHECK', value: 0 })
  })

  it('upper-cases names, since the vehicle only answers to one spelling', () => {
    expect(parseParamFile('angle_max,4500').entries[0]!.name).toBe('ANGLE_MAX')
  })

  it('reports junk lines rather than dropping them quietly', () => {
    // Silently importing the good half would pass off a partial configuration
    // as a whole one.
    const { entries, skipped } = parseParamFile('ANGLE_MAX,4500\nnonsense\nBAD,notanumber\n')
    expect(entries).toHaveLength(1)
    expect(skipped.map((s) => s.line)).toEqual([2, 3])
  })

  it('lets a later duplicate win, as every other tool does', () => {
    const { entries } = parseParamFile('ANGLE_MAX,1000\nANGLE_MAX,4500\n')
    expect(entries).toEqual([{ name: 'ANGLE_MAX', value: 4500 }])
  })

  it('round-trips through serialize', () => {
    const text = 'ANGLE_MAX,4500\nATC_ANG_PIT_P,4.5\n'
    expect(serializeParamFile(parseParamFile(text).entries)).toBe(text)
  })
})

describe('compareParams', () => {
  it('separates changed, unchanged and absent', () => {
    const rows = compareParams(
      [
        { name: 'ANGLE_MAX', value: 4500 }, // changed
        { name: 'ARMING_CHECK', value: 1 }, // same
        { name: 'Q_ENABLE', value: 1 }, // this vehicle has no such thing
      ],
      current,
    )
    expect(rows.map((r) => r.status)).toEqual(['changed', 'same', 'missing'])
    expect(rows[0]).toMatchObject({ currentValue: 3000, fileValue: 4500 })
    expect(rows[2]!.currentValue).toBeUndefined()
    expect(summarize(rows)).toEqual({ changed: 1, same: 1, missing: 1 })
  })

  it('does not call float32 noise a change', () => {
    // A float32 round trip turns 4.5 into 4.5000001, which is not an edit.
    const rows = compareParams([{ name: 'ATC_ANG_PIT_P', value: 4.5000001 }], current)
    expect(rows[0]!.status).toBe('same')
  })

  it('still sees a small but real change', () => {
    const rows = compareParams([{ name: 'ATC_ANG_PIT_P', value: 4.51 }], current)
    expect(rows[0]!.status).toBe('changed')
  })

  it('compares zero against a tiny value correctly', () => {
    // The relative comparison must still work when one side is 0.
    expect(sameValue(0, 0)).toBe(true)
    expect(sameValue(0, 0.001)).toBe(false)
    expect(sameValue(0, 0)).toBe(true)
  })
})
