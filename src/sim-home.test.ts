import { describe, expect, it } from 'vitest'
import { CMAC_HOME, formatHome, parseHome } from './sim-home'

describe('parseHome', () => {
  it('reads what a map puts on the clipboard', () => {
    const r = parseHome('38.9034, -77.0365')
    expect('home' in r && r.home).toEqual({
      latDeg: 38.9034,
      lonDeg: -77.0365,
      altM: 0,
      headingDeg: 0,
    })
  })

  it('accepts an altitude and a heading after them', () => {
    const r = parseHome('-35.363262, 149.165237, 584, 270')
    expect('home' in r && r.home).toEqual(CMAC_HOME)
  })

  it('tolerates the punctuation a paste brings with it', () => {
    for (const text of ['(38.9034, -77.0365)', '38.9034 -77.0365', '38.9034;-77.0365']) {
      const r = parseHome(text)
      expect('home' in r && r.home.latDeg).toBe(38.9034)
    }
  })

  it('names a swapped pair rather than booting in the wrong ocean', () => {
    // Latitude past the poles is the one coordinate typo that stays
    // plausible-looking all the way to a flying vehicle.
    const r = parseHome('149.165237, -35.363262')
    expect('error' in r && r.error).toMatch(/swapped/i)
  })

  it('rejects an out-of-range longitude', () => {
    expect('error' in parseHome('38.9, 200')).toBe(true)
  })

  it('points at decimal degrees when given degrees-minutes-seconds', () => {
    const r = parseHome(`38°54'12"N 77°02'11"W`)
    expect('error' in r && r.error).toMatch(/decimal degrees/i)
  })

  it('needs two numbers', () => {
    expect('error' in parseHome('38.9034')).toBe(true)
    expect('error' in parseHome('')).toBe(true)
    expect('error' in parseHome('1,2,3,4,5')).toBe(true)
  })

  it('round trips through the argument SITL wants', () => {
    const r = parseHome(formatHome(CMAC_HOME))
    expect('home' in r && r.home).toEqual(CMAC_HOME)
  })
})

