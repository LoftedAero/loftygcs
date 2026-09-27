import { describe, expect, it } from 'vitest'
import { splitKeypad } from './OutputsTab'
import { FRAME_CLASS, FRAME_TYPE, frameLayout } from '../../../protocol/frame-layout'

// The motor-test keypad is always two rows, so its card does not change
// height, and both rows are the same length for every frame ArduPilot can
// draw.

const steps = (cls: number, type: number) =>
  frameLayout(cls, type)!
    .map((m) => m.test)
    .sort((a, b) => a - b)

describe('the motor-test keypad', () => {
  it('halves every real frame into two equal rows', () => {
    for (const [cls, type, motors] of [
      [FRAME_CLASS.TRI, FRAME_TYPE.PLUS, 4], // three motors and the tail servo
      [FRAME_CLASS.QUAD, FRAME_TYPE.X, 4],
      [FRAME_CLASS.HEXA, FRAME_TYPE.X, 6],
      [FRAME_CLASS.Y6, FRAME_TYPE.Y6B, 6],
      [FRAME_CLASS.OCTA, FRAME_TYPE.X, 8],
      [FRAME_CLASS.OCTAQUAD, FRAME_TYPE.X, 8],
      [FRAME_CLASS.DECA, FRAME_TYPE.X, 10],
      [FRAME_CLASS.DODECAHEXA, FRAME_TYPE.X, 12],
    ] as const) {
      const s = steps(cls, type)
      expect(s.length).toBe(motors)
      const [top, bottom] = splitKeypad(s)
      expect(top!.length).toBe(bottom!.length)
      expect([...top!, ...bottom!]).toEqual(s)
    }
  })

  it('is still two rows for a count that cannot be halved', () => {
    // No drawable frame has an odd count, but the fallback keypad must
    // handle one.
    for (const n of [2, 3, 5, 8, 11, 12]) {
      const rows = splitKeypad(Array.from({ length: n }, (_, i) => i + 1))
      expect(rows.length).toBe(2)
      expect(rows[0]!.length + rows[1]!.length).toBe(n)
      expect(rows[0]!.length - rows[1]!.length).toBeLessThanOrEqual(1)
    }
  })
})
