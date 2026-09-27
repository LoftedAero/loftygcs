import { describe, expect, it } from 'vitest'
import {
  describeBoard,
  optionsForBoard,
  preferredPlatform,
  type FirmwareOption,
} from './firmware-manifest'

// Matching a board to its firmware, with the shape the real manifest has.
// Counts in these comments are from the live firmware.ardupilot.org manifest.

const opt = (
  o: Partial<FirmwareOption> & { platform: string; boardId: number },
): FirmwareOption => ({
  vehicle: 'Copter',
  vehicleLabel: 'Copter (multirotor)',
  channel: 'stable',
  current: true,
  version: '4.7.1',
  url: `https://example/${o.platform}.apj`,
  bootloaderStr: [`${o.platform}-BL`],
  brandName: null,
  ...o,
})

describe('narrowing to a detected board', () => {
  it('keeps only builds that board can take', () => {
    const all = [
      opt({ platform: 'CubeOrange', boardId: 140 }),
      opt({ platform: 'Pixhawk1', boardId: 9 }),
    ]
    expect(optionsForBoard(all, 140).map((o) => o.platform)).toEqual(['CubeOrange'])
  })

  it('names a board by its variants shared prefix, not by one of them', () => {
    // Board id 140 covers CubeOrange, CubeOrange-bdshot and
    // CubeOrange-SimOnHardWare, so it is not named after any one variant.
    const all = [
      opt({ platform: 'CubeOrange', boardId: 140 }),
      opt({ platform: 'CubeOrange-bdshot', boardId: 140 }),
      opt({ platform: 'CubeOrange-SimOnHardWare', boardId: 140 }),
    ]
    expect(describeBoard(all, 140)).toBe('CubeOrange')
  })

  it('prefers the manifest brand name where there is one', () => {
    const all = [opt({ platform: 'CubeOrangePlus', boardId: 1063, brandName: 'CubeOrange+' })]
    expect(describeBoard(all, 1063)).toBe('CubeOrange+')
  })

  it('falls back to the id when the platforms share no prefix', () => {
    // Board id 9 is fourteen unrelated boards (CubeBlack, Pixhawk1, fmuv2
    // and more), so it gets no name.
    const all = [
      opt({ platform: 'CubeBlack', boardId: 9 }),
      opt({ platform: 'Pixhawk1', boardId: 9 }),
      opt({ platform: 'fmuv2', boardId: 9 }),
    ]
    expect(describeBoard(all, 9)).toBe('board id 9')
  })

  it('says nothing about a board the manifest does not carry', () => {
    // 87 of 317 board ids have no Copter build at all.
    expect(describeBoard([opt({ platform: 'CubeOrange', boardId: 140 })], 999)).toBeNull()
  })
})

describe('the vehicle key', () => {
  it('separates a traditional heli from a multirotor', () => {
    // `vehicletype` is "Copter" for both; `mav-type` splits those 14,708
    // rows into Copter and HELICOPTER, which are different images.
    const all = [
      opt({ platform: 'CubeOrange', boardId: 140 }),
      opt({
        platform: 'CubeOrange',
        boardId: 140,
        vehicle: 'HELICOPTER',
        vehicleLabel: 'Copter (traditional heli)',
      }),
    ]
    const multi = all.filter((o) => o.vehicle === 'Copter')
    expect(multi).toHaveLength(1)
    expect(multi[0]!.url).not.toContain('heli')
  })
})

describe('choosing the build for a detected board', () => {
  // Board id 1063 (Cube Orange+) carries three platforms in the manifest,
  // so "one match or ask" would always prompt for a very common board.
  const plus = [
    opt({ platform: 'CubeOrangePlus', boardId: 1063 }),
    opt({ platform: 'CubeOrangePlus-bdshot', boardId: 1063 }),
    opt({ platform: 'CubeOrangePlus-SimOnHardWare', boardId: 1063 }),
  ]

  it('takes the plain build when the rest are suffixed variants of it', () => {
    expect(preferredPlatform(plus, 'Copter', 1063)).toBe('CubeOrangePlus')
  })

  it('still asks when the id covers genuinely different boards', () => {
    // Board id 9 is CubePurple, Pixhawk1 and fmuv3: no shared prefix, so
    // there is no plain build to fall back on.
    const nine = [
      opt({ platform: 'CubePurple', boardId: 9 }),
      opt({ platform: 'Pixhawk1', boardId: 9 }),
      opt({ platform: 'fmuv3', boardId: 9 }),
    ]
    expect(preferredPlatform(nine, 'Copter', 9)).toBeNull()
  })

  it('takes a lone match, and answers nothing for a board with no build', () => {
    expect(preferredPlatform([opt({ platform: 'Pixhawk6X', boardId: 53 })], 'Copter', 53)).toBe(
      'Pixhawk6X',
    )
    expect(preferredPlatform(plus, 'Copter', 999)).toBeNull()
  })
})
