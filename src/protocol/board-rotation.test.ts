import { describe, expect, it } from 'vitest'
import { ROTATION_COUNT, boardRotation } from './board-rotation'

const deg = (r: number) => (r * 180) / Math.PI

describe('the autopilot mounting rotation', () => {
  it('reads each fixed rotation as the firmware defines it', () => {
    // Yaw 90 turns the arrow to the right; Roll 90 stands the board on its
    // right edge (ArduPilot's own description).
    const yaw90 = boardRotation(2)!
    expect(deg(yaw90.yaw)).toBeCloseTo(90)
    const roll90 = boardRotation(16)!
    expect(deg(roll90.roll)).toBeCloseTo(90)
    expect(deg(roll90.pitch)).toBeCloseTo(0)
  })

  it('carries the one entry whose name is not its angles', () => {
    // ROTATION_ROLL_90_PITCH_68_YAW_293 is really 68.8 and 293.3, which is
    // why the table is copied rather than parsed from the names.
    const r = boardRotation(38)!
    expect(deg(r.pitch)).toBeCloseTo(68.8)
    expect(deg(r.yaw)).toBeCloseTo(293.3)
  })

  it('covers every fixed rotation, which is every frame of the sheet', () => {
    // ROTATION_MAX in the firmware's enum sits after ROLL_315 (43).
    expect(ROTATION_COUNT).toBe(44)
    expect(boardRotation(43)).not.toBeNull()
  })

  it('draws nothing for a rotation with no fixed angles', () => {
    // The custom rotations take theirs from parameters; a picture of them
    // level would be wrong.
    expect(boardRotation(101)).toBeNull()
    expect(boardRotation(44)).toBeNull()
    expect(boardRotation(-1)).toBeNull()
  })
})
