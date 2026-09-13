import { describe, expect, it } from 'vitest'
import { ICOSAHEDRON, SECTIONS, coverage, sectionCovered } from './geodesic-grid'

// The grid is transcribed from ArduPilot's AP_GeodesicGrid.h, and a wrong
// transcription does not look wrong: it draws a sphere with patches lit in
// the wrong places. So these check properties that follow from the
// specification rather than from the code above -- if the table were mistyped
// or the sub-triangle order swapped, at least one of them fails.

describe('the geodesic grid ArduPilot reports coverage in', () => {
  it('is an icosahedron tessellated by two: 20 triangles, 80 sections', () => {
    expect(ICOSAHEDRON).toHaveLength(20)
    expect(SECTIONS).toHaveLength(80)
    // Eighty is also what the ten-byte mask can address, which is the whole
    // reason the number matters.
    expect(SECTIONS.length).toBe(10 * 8)
  })

  it('puts every section vertex on the unit sphere', () => {
    for (const tri of SECTIONS) {
      expect(tri).toHaveLength(3)
      for (const v of tri) {
        expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 6)
      }
    }
  })

  it('has twelve distinct icosahedron vertices', () => {
    // A wrong golden-ratio term, or a mistyped sign, shows up here: the
    // twenty triangles must share exactly twelve corners between them.
    const seen = new Set(
      ICOSAHEDRON.flat().map((v) => v.map((n) => n.toFixed(4)).join(',')),
    )
    expect(seen.size).toBe(12)
  })

  it('pairs each triangle with its opposite ten places away', () => {
    // AP_GeodesicGrid.h: "T_j is the opposite of T_i iff j = (i + 10) % 20".
    for (let i = 0; i < 10; i++) {
      const a = ICOSAHEDRON[i]!
      const b = ICOSAHEDRON[i + 10]!
      for (let k = 0; k < 3; k++) {
        expect(b[k]![0]).toBeCloseTo(-a[k]![0], 9)
        expect(b[k]![1]).toBeCloseTo(-a[k]![1], 9)
        expect(b[k]![2]).toBeCloseTo(-a[k]![2], 9)
      }
    }
  })

  it('covers the whole sphere once, with no overlap', () => {
    // Solid angles of 80 equal-ish spherical triangles must sum to 4π. This
    // is the strongest check available without porting `section()`: it fails
    // if any triangle is degenerate, duplicated or missing.
    const solidAngle = (t: readonly (readonly number[])[]) => {
      const [a, b, c] = t as [number[], number[], number[]]
      const dot = (p: number[], q: number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!
      const det =
        a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
        a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)
      // Van Oosterom & Strackee.
      const denom = 1 + dot(a, b) + dot(b, c) + dot(a, c)
      return 2 * Math.atan2(Math.abs(det), denom)
    }
    const total = SECTIONS.reduce((sum, t) => sum + solidAngle(t), 0)
    expect(total).toBeCloseTo(4 * Math.PI, 6)
  })

  it('reads the mask the way the firmware writes it', () => {
    // CompassCalibrator.cpp: `_completion_mask[section / 8] |= 1 << (section % 8)`.
    const mask = new Array(10).fill(0)
    mask[0] = 0b0000_0101 // sections 0 and 2
    mask[9] = 0b1000_0000 // section 79, the last one
    expect(sectionCovered(mask, 0)).toBe(true)
    expect(sectionCovered(mask, 1)).toBe(false)
    expect(sectionCovered(mask, 2)).toBe(true)
    expect(sectionCovered(mask, 79)).toBe(true)
    expect(sectionCovered(mask, 78)).toBe(false)
    expect(coverage(mask)).toBeCloseTo(3 / 80, 9)
  })

  it('survives a short or empty mask rather than throwing', () => {
    // A vehicle that sends nothing useful is the normal state before the
    // first sample, and this draws every frame.
    expect(sectionCovered([], 0)).toBe(false)
    expect(coverage([])).toBe(0)
    expect(coverage(new Array(10).fill(0xff))).toBe(1)
  })
})
