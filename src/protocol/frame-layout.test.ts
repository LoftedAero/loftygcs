import { describe, expect, it } from 'vitest'
import {
  FRAME_CLASS,
  FRAME_CLASS_NAMES,
  FRAME_TYPE,
  classesForType,
  coaxialRank,
  frameLayout,
  frameTiles,
  frameTypeSupported,
} from './frame-layout'

// The table is transcribed from ArduPilot's AP_MotorsMatrix.cpp. These tests
// pin the resulting geometry (position, direction, motor count), since people
// check their propellers against the diagram.

const at = (cls: number, type: number) => frameLayout(cls, type)!
/** Round-trip a motor's position back to degrees clockwise from the nose. */
const bearing = (m: { x: number; y: number }) =>
  Math.round(((Math.atan2(m.x, m.y) * 180) / Math.PI) * 10) / 10

describe('quad layouts', () => {
  it('puts plus motor 1 at the nose and runs clockwise', () => {
    const plus = at(FRAME_CLASS.QUAD, FRAME_TYPE.PLUS)
    expect(plus).toHaveLength(4)
    expect(bearing(plus[0]!)).toBe(0)
    expect(bearing(plus[1]!)).toBe(90)
    expect(bearing(plus[2]!)).toBe(180)
    expect(bearing(plus[3]!)).toBe(-90)
    // Front and back turn one way, left and right the other.
    expect(plus.map((m) => m.spin)).toEqual(['cw', 'ccw', 'cw', 'ccw'])
  })

  it('puts X motors on the diagonals', () => {
    const x = at(FRAME_CLASS.QUAD, FRAME_TYPE.X)
    expect(x.map((m) => bearing(m))).toEqual([45, 135, -135, -45])
    expect(x.map((m) => m.spin)).toEqual(['ccw', 'cw', 'ccw', 'cw'])
  })

  it('reverses every propeller for the reversed plus', () => {
    const plus = at(FRAME_CLASS.QUAD, FRAME_TYPE.PLUS)
    const rev = at(FRAME_CLASS.QUAD, FRAME_TYPE.PLUSREV)
    expect(rev.map((m) => bearing(m))).toEqual(plus.map((m) => bearing(m)))
    expect(rev.every((m, i) => m.spin !== plus[i]!.spin)).toBe(true)
  })
})

describe('motor counts match the class', () => {
  it.each([
    [FRAME_CLASS.QUAD, FRAME_TYPE.X, 4],
    [FRAME_CLASS.HEXA, FRAME_TYPE.X, 6],
    [FRAME_CLASS.HEXA, FRAME_TYPE.H, 6],
    [FRAME_CLASS.OCTA, FRAME_TYPE.X, 8],
    [FRAME_CLASS.OCTA, FRAME_TYPE.I, 8],
    [FRAME_CLASS.OCTAQUAD, FRAME_TYPE.X, 8],
    [FRAME_CLASS.Y6, FRAME_TYPE.Y6B, 6],
    [FRAME_CLASS.DECA, FRAME_TYPE.X, 10],
    [FRAME_CLASS.DODECAHEXA, FRAME_TYPE.X, 12],
  ])('class %i type %i has %i motors', (cls, type, count) => {
    expect(at(cls, type)).toHaveLength(count)
  })

  it('numbers every motor once, and gives each one a test slot', () => {
    for (const [cls, type] of [
      [FRAME_CLASS.QUAD, FRAME_TYPE.X],
      [FRAME_CLASS.OCTA, FRAME_TYPE.PLUS],
      [FRAME_CLASS.DECA, FRAME_TYPE.PLUS],
      [FRAME_CLASS.DODECAHEXA, FRAME_TYPE.X],
    ] as const) {
      const motors = at(cls, type)
      const seq = motors.map((_, i) => i + 1)
      // Both numberings are permutations of 1..N, usually different ones. The
      // table is written in test order, so `test` is sorted and `n` is not.
      expect([...motors.map((m) => m.n)].sort((a, b) => a - b)).toEqual(seq)
      expect(motors.map((m) => m.test)).toEqual(seq)
    }
  })

  // The numbers on ArduPilot's published quad diagrams, which are drawn from
  // `AP_MotorsMatrix::setup_quad_matrix`.
  it('puts ArduPilot motor numbers where ArduPilot puts them', () => {
    const x = at(FRAME_CLASS.QUAD, FRAME_TYPE.X)
    const at_ = (n: number) => x.find((m) => m.n === n)!
    expect(at_(1)).toMatchObject({ x: 0.707, y: 0.707 }) // front right
    expect(at_(2)).toMatchObject({ x: -0.707, y: -0.707 }) // rear left
    expect(at_(3)).toMatchObject({ x: -0.707, y: 0.707 }) // front left
    expect(at_(4)).toMatchObject({ x: 0.707, y: -0.707 }) // rear right
    // ...and the test sequence walks them clockwise from the front right,
    // which is a different order: 1, 4, 2, 3.
    expect([1, 2, 3, 4].map((t) => x.find((m) => m.test === t)!.n)).toEqual([1, 4, 2, 3])

    // A plus frame's motor 1 is the *right* arm, not the front one.
    const plus = at(FRAME_CLASS.QUAD, FRAME_TYPE.PLUS)
    expect(plus.find((m) => m.n === 1)).toMatchObject({ x: 1, y: 0 })
    expect(plus.find((m) => m.test === 1)).toMatchObject({ n: 3, x: 0, y: 1 })
  })
})

describe('stacked frames', () => {
  it('puts both motors of a Y6 arm in the same place', () => {
    const y6 = at(FRAME_CLASS.Y6, FRAME_TYPE.Y6B)
    expect(coaxialRank(y6)).toEqual([0, 1, 0, 1, 0, 1])
    // Three arms, so three distinct positions.
    expect(new Set(y6.map((m) => `${m.x},${m.y}`)).size).toBe(3)
  })

  it('pairs an octaquad onto four arms', () => {
    const oq = at(FRAME_CLASS.OCTAQUAD, FRAME_TYPE.X)
    expect(new Set(oq.map((m) => `${m.x},${m.y}`)).size).toBe(4)
    expect(coaxialRank(oq)).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
  })

  it('has both propellers on an arm turning the same way when co-rotating', () => {
    const cor = at(FRAME_CLASS.OCTAQUAD, FRAME_TYPE.X_COR)
    expect(cor[0]!.spin).toBe(cor[1]!.spin)
    expect(cor[2]!.spin).toBe(cor[3]!.spin)
    // ...where the ordinary X8 opposes them.
    const x8 = at(FRAME_CLASS.OCTAQUAD, FRAME_TYPE.X)
    expect(x8[0]!.spin).not.toBe(x8[1]!.spin)
  })
})

describe('frames with no picture', () => {
  it('returns null rather than inventing one', () => {
    // Helicopters, single and coax copters, bicopters and the scripting
    // matrices: a swashplate or a Lua script, not a motor layout.
    expect(frameLayout(6, FRAME_TYPE.X)).toBeNull()
    expect(frameLayout(8, FRAME_TYPE.X)).toBeNull()
    expect(frameLayout(9, FRAME_TYPE.X)).toBeNull()
    expect(frameLayout(10, FRAME_TYPE.X)).toBeNull()
    expect(frameLayout(15, FRAME_TYPE.X)).toBeNull()
    // Supported by the firmware but not drawn: the quad's yaw-less variants.
    // Their case bodies are not transcribed, and a picture copied from the
    // plus would show yaw torque they do not have.
    expect(frameLayout(FRAME_CLASS.QUAD, FRAME_TYPE.NYT_PLUS)).toBeNull()
    expect(frameLayout(FRAME_CLASS.QUAD, FRAME_TYPE.NYT_X)).toBeNull()
    expect(frameTypeSupported(FRAME_CLASS.QUAD, FRAME_TYPE.NYT_X)).toBe(true)
  })

  it('falls back to the Y6 default for an unnamed Y6 type', () => {
    expect(frameLayout(FRAME_CLASS.Y6, FRAME_TYPE.X)).toHaveLength(6)
  })
})

describe('the class table follows the frame type', () => {
  it('offers only classes that can be drawn for that type', () => {
    // Plus and X are the two every class carries.
    expect(classesForType(FRAME_TYPE.PLUS)).toEqual([
      FRAME_CLASS.QUAD,
      FRAME_CLASS.HEXA,
      FRAME_CLASS.OCTA,
      FRAME_CLASS.OCTAQUAD,
      FRAME_CLASS.Y6,
      FRAME_CLASS.TRI,
      FRAME_CLASS.DODECAHEXA,
      FRAME_CLASS.DECA,
    ])
    expect(classesForType(FRAME_TYPE.X)).toEqual(classesForType(FRAME_TYPE.PLUS))
  })

  it('drops the classes a type does not reach', () => {
    // A V layout exists for the quad, octa and octaquad, not the hexa, deca or
    // dodecahexa. Y6 always qualifies: its firmware uses one layout for any
    // type it does not name.
    const v = classesForType(FRAME_TYPE.V)
    expect(v).toContain(FRAME_CLASS.QUAD)
    expect(v).toContain(FRAME_CLASS.OCTA)
    expect(v).toContain(FRAME_CLASS.OCTAQUAD)
    expect(v).toContain(FRAME_CLASS.Y6)
    expect(v).not.toContain(FRAME_CLASS.HEXA)
    expect(v).not.toContain(FRAME_CLASS.DECA)
    expect(v).not.toContain(FRAME_CLASS.DODECAHEXA)

    // The sideways-H octa is the only matrix class with an I layout; Y6 and
    // the tricopter come along because neither reads the frame type.
    expect(classesForType(FRAME_TYPE.I)).toEqual([
      FRAME_CLASS.OCTA,
      FRAME_CLASS.Y6,
      FRAME_CLASS.TRI,
    ])
  })

  it('names every class it offers', () => {
    for (const c of classesForType(FRAME_TYPE.X)) {
      expect(FRAME_CLASS_NAMES[c]).toBeTruthy()
    }
  })
})

describe('what the firmware will actually accept', () => {
  it('knows the classes that refuse a type', () => {
    // Quoted from AP_MotorsMatrix::setup_motors: each class ends in
    // `default: return false`, and a hexa's switch has no V case.
    expect(frameTypeSupported(FRAME_CLASS.HEXA, FRAME_TYPE.V)).toBe(false)
    expect(frameTypeSupported(FRAME_CLASS.DECA, FRAME_TYPE.H)).toBe(false)
    expect(frameTypeSupported(FRAME_CLASS.DODECAHEXA, FRAME_TYPE.V)).toBe(false)
    expect(frameTypeSupported(FRAME_CLASS.OCTAQUAD, FRAME_TYPE.I)).toBe(false)
    expect(frameTypeSupported(FRAME_CLASS.QUAD, FRAME_TYPE.I)).toBe(false)
  })

  it('accepts everything the firmware accepts', () => {
    for (const t of [FRAME_TYPE.PLUS, FRAME_TYPE.X, FRAME_TYPE.V, FRAME_TYPE.H, FRAME_TYPE.VTAIL,
      FRAME_TYPE.ATAIL, FRAME_TYPE.PLUSREV, FRAME_TYPE.Y4, FRAME_TYPE.NYT_PLUS, FRAME_TYPE.NYT_X,
      FRAME_TYPE.BF_X, FRAME_TYPE.BF_X_REV, FRAME_TYPE.DJI_X, FRAME_TYPE.CW_X]) {
      expect(frameTypeSupported(FRAME_CLASS.QUAD, t)).toBe(true)
    }
    // Deca takes CW_X as well as plus and X; the firmware shares one body.
    expect(frameTypeSupported(FRAME_CLASS.DECA, FRAME_TYPE.CW_X)).toBe(true)
    expect(frameLayout(FRAME_CLASS.DECA, FRAME_TYPE.CW_X)).toHaveLength(10)
  })

  it('treats Y6 as taking any type, because its switch has no failing default', () => {
    for (const t of [FRAME_TYPE.PLUS, FRAME_TYPE.X, FRAME_TYPE.I, FRAME_TYPE.Y6B]) {
      expect(frameTypeSupported(FRAME_CLASS.Y6, t)).toBe(true)
    }
  })

  it('never calls an unknown class unsupported', () => {
    // Helicopters, tricopters and scripting matrices never reach the motor
    // matrix, and an unknown class may be one newer firmware added.
    expect(frameTypeSupported(6, FRAME_TYPE.X)).toBe(true)
    expect(frameTypeSupported(7, FRAME_TYPE.V)).toBe(true)
    expect(frameTypeSupported(99, FRAME_TYPE.I)).toBe(true)
  })

  it('draws the frames that needed the other two add_motor forms', () => {
    // V-tail: two front motors with no yaw authority, two canted at the tail.
    const vtail = at(FRAME_CLASS.QUAD, FRAME_TYPE.VTAIL)
    expect(vtail).toHaveLength(4)
    expect(vtail.filter((m) => m.spin === 'none')).toHaveLength(2)
    // Both tail motors sit on the centerline (roll factor 0), so they coincide
    // and the second is drawn offset.
    expect(coaxialRank(vtail)).toEqual([0, 0, 1, 0])
    // A-tail is the same geometry with the tail pair reversed.
    const atail = at(FRAME_CLASS.QUAD, FRAME_TYPE.ATAIL)
    expect(atail.map((m) => [m.x, m.y])).toEqual(vtail.map((m) => [m.x, m.y]))
    expect(atail[1]!.spin).not.toBe(vtail[1]!.spin)
    // Y4: three arms, the back two stacked.
    expect(at(FRAME_CLASS.QUAD, FRAME_TYPE.Y4)).toHaveLength(4)
  })
})

describe('the table holds still while the type changes', () => {
  const TYPES = [
    FRAME_TYPE.PLUS,
    FRAME_TYPE.X,
    FRAME_TYPE.V,
    FRAME_TYPE.H,
    FRAME_TYPE.I,
    FRAME_TYPE.Y6B,
    FRAME_TYPE.VTAIL,
    FRAME_TYPE.X_COR,
    FRAME_TYPE.NYT_X,
  ]

  it('shows the same classes whatever the type', () => {
    const first = frameTiles(FRAME_TYPE.PLUS).map((t) => t.frameClass)
    expect(first).toHaveLength(8)
    for (const t of TYPES) {
      expect(frameTiles(t).map((x) => x.frameClass)).toEqual(first)
    }
  })

  it('never returns a tile with nothing to draw', () => {
    for (const t of TYPES) {
      for (const tile of frameTiles(t)) {
        expect(tile.motors.length).toBeGreaterThan(0)
      }
    }
  })

  it('draws the chosen type where the class takes it', () => {
    for (const tile of frameTiles(FRAME_TYPE.V)) {
      if (!tile.supported) continue
      expect(tile.drawnType).toBe(FRAME_TYPE.V)
    }
  })

  it('falls back to a recognisable shape where it does not', () => {
    // A quad cannot be a Y6B; a blank quad beside a drawn Y6 would read as the
    // wrong one being valid.
    const tiles = frameTiles(FRAME_TYPE.Y6B)
    const quad = tiles.find((t) => t.frameClass === FRAME_CLASS.QUAD)!
    expect(quad.supported).toBe(false)
    expect(quad.drawnType).toBe(FRAME_TYPE.X)
    expect(quad.motors).toHaveLength(4)

    const y6 = tiles.find((t) => t.frameClass === FRAME_CLASS.Y6)!
    expect(y6.supported).toBe(true)
    expect(y6.drawnType).toBe(FRAME_TYPE.Y6B)
  })

  it('marks exactly the classes the firmware refuses', () => {
    const byClass = Object.fromEntries(
      frameTiles(FRAME_TYPE.V).map((t) => [t.frameClass, t.supported]),
    )
    expect(byClass[FRAME_CLASS.QUAD]).toBe(true)
    expect(byClass[FRAME_CLASS.OCTA]).toBe(true)
    expect(byClass[FRAME_CLASS.Y6]).toBe(true)
    expect(byClass[FRAME_CLASS.HEXA]).toBe(false)
    expect(byClass[FRAME_CLASS.DECA]).toBe(false)
    expect(byClass[FRAME_CLASS.DODECAHEXA]).toBe(false)
  })
})

describe('the tricopter', () => {
  it('draws the same aircraft whatever the frame type', () => {
    // AP_MotorsTri never reads FRAME_TYPE, so there is one tricopter layout.
    const plus = frameLayout(FRAME_CLASS.TRI, FRAME_TYPE.PLUS)
    for (const t of [FRAME_TYPE.X, FRAME_TYPE.V, FRAME_TYPE.Y6B, FRAME_TYPE.I]) {
      expect(frameLayout(FRAME_CLASS.TRI, t)).toEqual(plus)
    }
  })

  it('places the arms from the source factors', () => {
    const tri = at(FRAME_CLASS.TRI, FRAME_TYPE.PLUS)
    // Front pair: roll factors -1 and +1 with pitch 0.5; rear: pitch -1.
    // `AP_MotorsTri` drives MOT_1 right, MOT_2 left and MOT_4 rear (there is
    // no motor 3), while the test sequence is right, rear, servo, left.
    expect(tri.find((m) => m.n === 1)).toMatchObject({ x: 1, y: 0.5, test: 1 })
    expect(tri.find((m) => m.n === 2)).toMatchObject({ x: -1, y: 0.5, test: 4 })
    expect(tri.find((m) => m.n === 4)).toMatchObject({ x: 0, y: -1, test: 2 })
    expect(tri.some((m) => m.n === 3)).toBe(false)
  })

  it('labels the tail servo with its output channel', () => {
    const tri = at(FRAME_CLASS.TRI, FRAME_TYPE.PLUS)
    const servo = tri.find((m) => m.servo)!
    // `AP_MotorsTri.h`: "tail servo uses channel 7". The motor test reaches it
    // as step 3, but 7 is the output it is wired to.
    expect(servo.n).toBe(7)
    // It sits on the rear arm, so it is offset rather than hidden under the
    // back motor.
    expect(coaxialRank(tri)).toEqual([0, 0, 1, 0])
    expect(tri.filter((m) => m.servo)).toHaveLength(1)
  })

  it('shows a counter-rotating front pair, by convention not by source', () => {
    // AP_MotorsTri states no directions (yaw comes from the tail servo), so
    // these are the conventional build. The servo gets no direction.
    const tri = at(FRAME_CLASS.TRI, FRAME_TYPE.PLUS)
    const front = tri.filter((m) => m.y > 0)
    expect(front.map((m) => m.spin).sort()).toEqual(['ccw', 'cw'])
    expect(tri.find((m) => m.servo)!.spin).toBe('none')
    expect(tri.filter((m) => m.spin === 'none')).toHaveLength(1)
  })

  it('is never marked unsupported, whatever the type says', () => {
    for (const t of [FRAME_TYPE.PLUS, FRAME_TYPE.I, FRAME_TYPE.Y6B, FRAME_TYPE.X_COR]) {
      const tile = frameTiles(t).find((x) => x.frameClass === FRAME_CLASS.TRI)!
      expect(tile.supported).toBe(true)
      expect(tile.motors).toHaveLength(4)
    }
  })
})
