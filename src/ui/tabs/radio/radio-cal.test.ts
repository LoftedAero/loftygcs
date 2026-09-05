import { describe, expect, it } from 'vitest'
import {
  MIN_DEFLECTION_US,
  STICK_SPECS,
  buildWrites,
  claimedChannels,
  conflictingFunctions,
  detectDeflection,
  exercisedChannels,
  mappingFromDeflection,
  updateTravel,
  type CalibrationResult,
  type Travel,
} from './radio-cal'

const CENTER = [1500, 1500, 1100, 1500, 1500, 1500]

describe('detectDeflection', () => {
  it('finds the channel that moved and which way', () => {
    const now = [1500, 1500, 1900, 1500, 1500, 1500]
    expect(detectDeflection(CENTER, now)).toEqual({ channel: 3, delta: 800 })
  })

  it('reports a negative delta for a transmitter that runs backwards', () => {
    const now = [1120, 1500, 1100, 1500, 1500, 1500]
    expect(detectDeflection(CENTER, now)).toEqual({ channel: 1, delta: -380 })
  })

  it('holds off until something is actually deflected', () => {
    // Idle jitter must not be mistaken for a stick throw, or the wizard maps
    // whichever channel happened to twitch.
    expect(detectDeflection(CENTER, [1508, 1495, 1103, 1502, 1500, 1500])).toBeNull()
    const justUnder = CENTER.slice()
    justUnder[0] = 1500 + MIN_DEFLECTION_US - 1
    expect(detectDeflection(CENTER, justUnder)).toBeNull()
  })

  it('refuses to choose between two channels moving together', () => {
    // Both sticks knocked at once: better to ask again than to guess.
    const now = [1900, 1880, 1100, 1500, 1500, 1500]
    expect(detectDeflection(CENTER, now)).toBeNull()
  })

  it('still decides when one channel clearly leads', () => {
    const now = [1900, 1560, 1100, 1500, 1500, 1500]
    expect(detectDeflection(CENTER, now)?.channel).toBe(1)
  })

  it('skips channels an earlier step already claimed', () => {
    // The throttle has no spring, so it is normal for it to still be sitting
    // at the top when the next stick is asked for. Left in the running it
    // would out-deflect every later stick and win all four steps.
    const now = [1900, 1500, 1900, 1500, 1500, 1500]
    expect(detectDeflection(CENTER, now)?.channel).toBe(3)
    expect(detectDeflection(CENTER, now, new Set([3]))?.channel).toBe(1)
    expect(detectDeflection(CENTER, now, new Set([1, 3]))).toBeNull()
  })

  it('ignores channels with no signal at all', () => {
    // A receiver reporting zeros on unused channels must not look like a
    // huge deflection away from a zero reference.
    const reference = [1500, 0, 0]
    const now = [1900, 0, 0]
    expect(detectDeflection(reference, now)).toEqual({ channel: 1, delta: 400 })
  })
})

describe('mappingFromDeflection', () => {
  it('calls a channel reversed when the max direction lowered the pulse', () => {
    expect(mappingFromDeflection({ channel: 2, delta: -400 })).toEqual({
      channel: 2,
      reversed: true,
    })
    expect(mappingFromDeflection({ channel: 2, delta: 400 })).toEqual({
      channel: 2,
      reversed: false,
    })
  })
})

describe('the stick conventions', () => {
  it('asks for pitch back rather than forward', () => {
    // ArduPilot's pitch input keeps its sign through to the Euler angle, and
    // positive Euler pitch is nose up -- so the maximum is stick back. Get
    // this backwards and every calibration reverses the elevator.
    expect(STICK_SPECS.pitch.maxDirection).toContain('back')
    expect(STICK_SPECS.roll.maxDirection).toContain('right')
    expect(STICK_SPECS.yaw.maxDirection).toContain('right')
    expect(STICK_SPECS.throttle.maxDirection).toContain('up')
  })

  it('draws the two vertical sticks in a consistent frame', () => {
    // Screen up means away from the pilot: the throttle is pushed away and
    // the pitch stick is pulled toward, so they must draw opposite ways.
    // Purely presentational -- but drawing them the same way would tell the
    // user to move the wrong stick the wrong way.
    expect(STICK_SPECS.throttle.axis).toBe('y')
    expect(STICK_SPECS.pitch.axis).toBe('y')
    expect(STICK_SPECS.throttle.sense).toBe(1)
    expect(STICK_SPECS.pitch.sense).toBe(-1)
  })

  it('writes each function to its own RCMAP parameter', () => {
    expect(STICK_SPECS.roll.rcmapParam).toBe('RCMAP_ROLL')
    expect(STICK_SPECS.pitch.rcmapParam).toBe('RCMAP_PITCH')
    expect(STICK_SPECS.yaw.rcmapParam).toBe('RCMAP_YAW')
    expect(STICK_SPECS.throttle.rcmapParam).toBe('RCMAP_THROTTLE')
  })
})

describe('updateTravel', () => {
  it('widens the extremes as samples arrive', () => {
    let travel: Travel[] = []
    travel = updateTravel(travel, [1500, 1500])
    travel = updateTravel(travel, [1100, 1600])
    travel = updateTravel(travel, [1900, 1400])
    expect(travel).toEqual([
      { min: 1100, max: 1900 },
      { min: 1400, max: 1600 },
    ])
  })

  it('skips channels that are not reporting', () => {
    const travel = updateTravel([], [1500, 0])
    expect(travel[1]).toBeUndefined()
  })
})

describe('exercisedChannels', () => {
  it('keeps only channels that were really swept', () => {
    // A switch nudged a few microseconds by vibration is not a calibrated
    // channel, and writing its resting value as both endpoints breaks it.
    const travel: Travel[] = [
      { min: 1100, max: 1900 },
      { min: 1495, max: 1505 },
      { min: 1000, max: 2000 },
    ]
    expect(exercisedChannels(travel)).toEqual([1, 3])
  })
})

describe('claimedChannels', () => {
  it('collects the channels already assigned', () => {
    expect(
      [
        ...claimedChannels({
          throttle: { channel: 3, reversed: false },
          yaw: { channel: 4, reversed: false },
        }),
      ].sort(),
    ).toEqual([3, 4])
  })

  it('is empty before anything is identified', () => {
    expect(claimedChannels({}).size).toBe(0)
  })
})

describe('conflictingFunctions', () => {
  it('is empty for a clean mapping', () => {
    expect(
      conflictingFunctions({
        roll: { channel: 1, reversed: false },
        pitch: { channel: 2, reversed: true },
      }),
    ).toEqual([])
  })

  it('names both functions when one channel was claimed twice', () => {
    // Happens when the user moves the same stick for two steps running.
    const clash = conflictingFunctions({
      roll: { channel: 1, reversed: false },
      pitch: { channel: 1, reversed: false },
      yaw: { channel: 4, reversed: false },
    })
    expect(clash.sort()).toEqual(['pitch', 'roll'])
  })
})

describe('buildWrites', () => {
  const result: CalibrationResult = {
    mapping: {
      roll: { channel: 1, reversed: false },
      pitch: { channel: 2, reversed: true },
      throttle: { channel: 3, reversed: false },
      yaw: { channel: 4, reversed: false },
    },
    travel: [
      { min: 1100, max: 1900 },
      { min: 1090, max: 1910 },
      { min: 1000, max: 2000 },
      { min: 1100, max: 1900 },
      { min: 1495, max: 1500 }, // untouched switch
    ],
    centers: [1500, 1500, 1450, 1500, 1500],
  }
  const writes = buildWrites(result)
  const find = (param: string) => writes.find((w) => w.param === param)?.value

  it('writes endpoints for every channel that moved', () => {
    expect(find('RC1_MIN')).toBe(1100)
    expect(find('RC1_MAX')).toBe(1900)
    expect(find('RC3_MAX')).toBe(2000)
  })

  it('leaves an unexercised channel alone entirely', () => {
    expect(find('RC5_MIN')).toBeUndefined()
    expect(find('RC5_TRIM')).toBeUndefined()
  })

  it('trims the sticks to center but the throttle to its bottom', () => {
    // ArduPilot reads throttle as a range from MIN to MAX with no neutral,
    // so a mid-stick trim there is meaningless at best.
    expect(find('RC1_TRIM')).toBe(1500)
    expect(find('RC3_TRIM')).toBe(1000)
  })

  it('records the reversals it detected', () => {
    expect(find('RC2_REVERSED')).toBe(1)
    expect(find('RC1_REVERSED')).toBe(0)
  })

  it('maps each function to the channel that answered for it', () => {
    expect(find('RCMAP_ROLL')).toBe(1)
    expect(find('RCMAP_PITCH')).toBe(2)
    expect(find('RCMAP_THROTTLE')).toBe(3)
    expect(find('RCMAP_YAW')).toBe(4)
  })

  it('puts the RCMAP writes last, after the endpoints they depend on', () => {
    const firstMap = writes.findIndex((w) => w.param.startsWith('RCMAP_'))
    const lastEndpoint = writes.map((w) => w.param).lastIndexOf('RC4_MAX')
    expect(firstMap).toBeGreaterThan(lastEndpoint)
  })

  it('handles a partial calibration without inventing parameters', () => {
    const partial = buildWrites({
      mapping: { roll: { channel: 1, reversed: false } },
      travel: [{ min: 1100, max: 1900 }],
      centers: [1500],
    })
    expect(partial.map((w) => w.param)).toEqual([
      'RC1_MIN',
      'RC1_MAX',
      'RC1_TRIM',
      'RC1_REVERSED',
      'RCMAP_ROLL',
    ])
  })
})
