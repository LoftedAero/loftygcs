import { describe, expect, it } from 'vitest'
import { BOARD_COUNT, UNAMBIGUOUS_ID_COUNT, timerGroups } from './timer-groups'

// The table is generated from ArduPilot's hwdef tree by
// scripts/hwdef-timer-groups.mjs. Its contents are upstream's; these tests pin
// what the generator has to get right, against known boards.

describe('the generated timer-group table', () => {
  it('has a plausible number of boards', () => {
    // Guards against a generator run that silently drops boards (for example
    // a board-id regex that skips hyphenated symbols).
    expect(BOARD_COUNT).toBeGreaterThan(300)
    expect(UNAMBIGUOUS_ID_COUNT).toBeGreaterThan(150)
  })

  it('groups by timer, not by run of channels', () => {
    // MatekH743 has no IOMCU, so its hwdef channels are its output numbers:
    // TIM8 1-2, TIM5 3-6, TIM4 7-10, TIM15 11-12, TIM1 13.
    const b = timerGroups('MatekH743', 0)!
    expect(b.groups).toEqual([
      [1, 2, 'TIM8'],
      [3, 6, 'TIM5'],
      [7, 10, 'TIM4'],
      [11, 12, 'TIM15'],
      [13, 13, 'TIM1'],
    ])
  })

  it('puts the IOMCU first and shifts the FMU by eight', () => {
    // A Cube drives outputs 1-8 from its IO co-processor, whose own layout is
    // fixed, and its hwdef's PWM(1) is output 9.
    const b = timerGroups('CubeOrange', 0)!
    expect(b.groups.slice(0, 3)).toEqual([
      [1, 2, 'TIM2'],
      [3, 4, 'TIM4'],
      [5, 8, 'TIM3'],
    ])
    expect(b.groups.slice(3)).toEqual([
      [9, 12, 'TIM1'],
      [13, 14, 'TIM4'],
    ])
  })

  it('carries NODMA, which is what stops a group doing DShot', () => {
    const b = timerGroups('Pixhawk6X', 0)!
    expect(b.groups.at(-1)).toEqual([15, 16, 'TIM12', 1])
  })

  it('refuses to answer from a board id that means several boards', () => {
    // Id 9 is CubeBlack, Pixhawk1, fmuv3 and skyviper, which are different
    // hardware.
    expect(timerGroups('CubeBlack', 0)).not.toBeNull()
    expect(timerGroups('Pixhawk1', 0)).not.toBeNull()
    expect(timerGroups(null, 9)).toBeNull()
    // MatekH743's `-bdshot` sibling shares id 1013 but uses different timers
    // (TIM8 1-2 against TIM3 1-2).
    expect(timerGroups(null, 1013)).toBeNull()
    expect(timerGroups('MatekH743', 0)!.groups[0]).toEqual([1, 2, 'TIM8'])
    expect(timerGroups('MatekH743-bdshot', 0)!.groups[0]).toEqual([1, 2, 'TIM3'])

    // An id whose boards all agree is a usable fallback when the vehicle does
    // not name itself.
    const cube = timerGroups('CubeOrange', 0)!
    expect(timerGroups(null, 140)).toEqual(cube)
  })

  it('says nothing for a vehicle that identifies neither way', () => {
    // SITL and the demo vehicle: no board id, no ChibiOS board name.
    expect(timerGroups(null, 0)).toBeNull()
    expect(timerGroups('NotARealBoard', 999999)).toBeNull()
  })
})
