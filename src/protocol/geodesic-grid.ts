// The 80 sphere sections ArduPilot's compass calibration reports coverage in.
//
// MAG_CAL_PROGRESS carries a ten-byte `completion_mask`, one bit per section.
// The sections are the faces of an icosahedron tessellated by a factor of
// two: each of the twenty triangles split into four by bisecting its edges,
// with every vertex projected onto the sphere. A section's index is
// `i * 4 + j` for icosahedron triangle i in [0,20) and sub-triangle j in
// [0,4), and its bit is `completion_mask[section / 8] & (1 << (section % 8))`.
//
// The ordering of both the triangles and the sub-triangles is transcribed
// from AP_GeodesicGrid.h. A wrong order still draws a plausible sphere, just
// with the wrong patches lit.

/** The golden ratio, from which the icosahedron's vertices are built. */
const G = (1 + Math.sqrt(5)) / 2

export type Vec3 = readonly [number, number, number]

/**
 * The first ten icosahedron triangles, verbatim from AP_GeodesicGrid.h. The
 * other ten are their opposites: T_(i+10) = -T_i.
 */
const HALF: readonly (readonly Vec3[])[] = [
  [
    [-G, 1, 0],
    [-1, 0, -G],
    [-G, -1, 0],
  ],
  [
    [-1, 0, -G],
    [-G, -1, 0],
    [0, -G, -1],
  ],
  [
    [-G, -1, 0],
    [0, -G, -1],
    [0, -G, 1],
  ],
  [
    [-1, 0, -G],
    [0, -G, -1],
    [1, 0, -G],
  ],
  [
    [0, -G, -1],
    [0, -G, 1],
    [G, -1, 0],
  ],
  [
    [0, -G, -1],
    [1, 0, -G],
    [G, -1, 0],
  ],
  [
    [G, -1, 0],
    [1, 0, -G],
    [G, 1, 0],
  ],
  [
    [1, 0, -G],
    [G, 1, 0],
    [0, G, -1],
  ],
  [
    [1, 0, -G],
    [0, G, -1],
    [-1, 0, -G],
  ],
  [
    [0, G, -1],
    [-G, 1, 0],
    [-1, 0, -G],
  ],
]

const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]

/** Onto the unit sphere: the grid is about directions, not distances. */
export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** The twenty icosahedron triangles, in ArduPilot's order. */
export const ICOSAHEDRON: readonly (readonly Vec3[])[] = [
  ...HALF,
  ...HALF.map((t) => t.map(neg) as Vec3[]),
]

/**
 * The eighty sections, index `i * 4 + j`, each a triangle on the unit sphere.
 *
 * Sub-triangle order is the header's: W_0 is the middle triangle, then the
 * three corner triangles in the order (a, m_a, m_c), (m_a, b, m_b),
 * (m_c, m_b, c).
 */
export const SECTIONS: readonly (readonly Vec3[])[] = ICOSAHEDRON.flatMap((t) => {
  const [a, b, c] = t as [Vec3, Vec3, Vec3]
  const ma = mid(a, b)
  const mb = mid(b, c)
  const mc = mid(c, a)
  return [
    [ma, mb, mc],
    [a, ma, mc],
    [ma, b, mb],
    [mc, mb, c],
  ].map((tri) => tri.map(normalize) as Vec3[])
})

/** Whether section `i` is covered, given the ten-byte mask from the vehicle. */
export function sectionCovered(mask: readonly number[], i: number): boolean {
  const byte = mask[Math.floor(i / 8)]
  return byte !== undefined && (byte & (1 << i % 8)) !== 0
}

/** How much of the sphere the mask covers, 0..1. */
export function coverage(mask: readonly number[]): number {
  let n = 0
  for (let i = 0; i < SECTIONS.length; i++) if (sectionCovered(mask, i)) n++
  return n / SECTIONS.length
}
