import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { getSeries, parseDataflash, type MessageTable, type ParsedLog } from './dataflash'
import { evaluateExpression, expressionError, ExpressionError } from './log-expression'

const real = parseDataflash(
  new Uint8Array(gunzipSync(readFileSync('src/test-fixtures/copter-sitl.bin.gz'))),
)

/** A log with exactly the series a test needs, at rates it chooses. */
function logWith(messages: Record<string, Record<string, number[]>>): ParsedLog {
  const out = new Map<string, MessageTable>()
  for (const [name, cols] of Object.entries(messages)) {
    out.set(name, {
      format: {
        type: 1,
        name,
        length: 0,
        fields: Object.keys(cols).map((f) => ({ name: f, format: 'f' })),
      },
      count: Object.values(cols)[0]!.length,
      columns: new Map(Object.entries(cols).map(([k, v]) => [k, Float64Array.from(v)])),
    })
  }
  return { messages: out, params: new Map(), problems: [], skippedBytes: 0 }
}

const simple = logWith({
  A: { TimeUS: [0, 1, 2, 3], X: [0, 10, 20, 30], Y: [1, 1, 1, 1] },
  // Half the rate of A, and offset, so resampling has to do real work.
  B: { TimeUS: [0, 2], Z: [0, 100] },
})

const evalAt = (source: string, log: ParsedLog = simple) =>
  Array.from(evaluateExpression(log, source).values)

describe('arithmetic', () => {
  it('adds, subtracts, multiplies and divides fields', () => {
    expect(evalAt('A.X + A.Y')).toEqual([1, 11, 21, 31])
    expect(evalAt('A.X - A.Y')).toEqual([-1, 9, 19, 29])
    expect(evalAt('A.X * 2')).toEqual([0, 20, 40, 60])
    expect(evalAt('A.X / 10')).toEqual([0, 1, 2, 3])
  })

  it('respects precedence and brackets', () => {
    expect(evalAt('A.Y + A.X * 2')).toEqual([1, 21, 41, 61])
    expect(evalAt('(A.Y + A.X) * 2')).toEqual([2, 22, 42, 62])
  })

  it('treats ^ the way a spreadsheet does', () => {
    // Right-associative and binding tighter than unary minus: -2^2 is -4,
    // and 2^3^2 is 512 rather than 64. Anyone typing here expects Excel.
    expect(evalAt('-2^2 + A.Y')).toEqual([-3, -3, -3, -3])
    expect(evalAt('2^3^2 * A.Y')).toEqual([512, 512, 512, 512])
  })

  it('applies unary minus to fields', () => {
    expect(evalAt('-A.X')).toEqual([-0, -10, -20, -30])
  })

  it('calls functions, including two-argument ones', () => {
    expect(evalAt('sqrt(A.X * A.X)')).toEqual([0, 10, 20, 30])
    expect(evalAt('max(A.X, 15)')).toEqual([15, 15, 20, 30])
    expect(evalAt('abs(0 - A.X)')).toEqual([0, 10, 20, 30])
  })

  it('knows degrees, radians and pi', () => {
    expect(evalAt('deg(pi) * A.Y')[0]).toBeCloseTo(180, 9)
    expect(evalAt('rad(180) * A.Y')[0]).toBeCloseTo(Math.PI, 9)
  })

  it('leaves a bad sample as infinity rather than losing the plot', () => {
    // One divide by zero should be a gap in a trace, not an exception that
    // takes the whole expression down.
    expect(evalAt('A.Y / (A.X - 10)')[1]).toBe(Infinity)
  })
})

describe('lining up series that were logged at different rates', () => {
  it('evaluates on the first reference’s timeline', () => {
    // A is 4 samples, B is 2. The result follows A.
    const r = evaluateExpression(simple, 'A.X + B.Z')
    expect(Array.from(r.time)).toEqual([0, 1, 2, 3])
    expect(r.references).toEqual(['A.X', 'B.Z'])
  })

  it('interpolates the slower series between its samples', () => {
    // A leads, so the timeline is A's four samples. B.Z goes 0 -> 100
    // between t=0 and t=2, so at t=1 it is 50.
    expect(evalAt('A.Y + B.Z')).toEqual([1, 51, 101, 101])
  })

  it('holds the last value past the end rather than extrapolating', () => {
    // B stops at t=2; at t=3 it stays 100. Running a trend off the end of
    // the data would invent numbers nobody logged.
    expect(evalAt('A.Y + B.Z')[3]).toBe(101)
  })

  it('follows the first reference even when it is the slower one', () => {
    const r = evaluateExpression(simple, 'B.Z + A.X')
    expect(Array.from(r.time)).toEqual([0, 2])
    expect(Array.from(r.values)).toEqual([0, 120])
  })
})

describe('saying what is wrong', () => {
  const fails = (source: string) => {
    try {
      evaluateExpression(simple, source)
      return null
    } catch (err) {
      return err instanceof ExpressionError ? err.message : `wrong error: ${String(err)}`
    }
  }

  it('names a field the log does not have', () => {
    expect(fails('A.Nope + 1')).toMatch(/no A\.Nope/)
    expect(fails('NOSUCH.X')).toMatch(/no NOSUCH\.X/)
  })

  it('names an unknown function or bare word', () => {
    expect(fails('wobble(A.X)')).toMatch(/Unknown name "wobble"/)
    expect(fails('A.X + Roll')).toMatch(/Unknown name "Roll"/)
  })

  it('reports unbalanced brackets and stray characters', () => {
    expect(fails('(A.X + 1')).toMatch(/closing bracket/)
    expect(fails('A.X @ 2')).toMatch(/Unexpected character/)
    expect(fails('A.X +')).toMatch(/ends too early/)
  })

  it('refuses an expression with no fields at all', () => {
    // 2+2 is arithmetic, not a trace; plotting a constant is never what
    // was meant and the flat line does not say so.
    expect(fails('2 + 2')).toMatch(/nothing to plot/)
    expect(fails('   ')).toMatch(/Type an expression/)
  })

  it('checks without evaluating, for a live error under the input', () => {
    expect(expressionError(simple, 'A.X * 2')).toBeNull()
    expect(expressionError(simple, 'A.X *')).toMatch(/ends too early/)
    expect(expressionError(simple, 'A.Missing')).toMatch(/no A\.Missing/)
  })
})

describe('against a real log', () => {
  it('computes an attitude tracking error', () => {
    const r = evaluateExpression(real, 'ATT.DesRoll - ATT.Roll')
    const roll = getSeries(real, 'ATT', 'Roll')!
    expect(r.values.length).toBe(roll.values.length)
    // A copter sitting still tracks its target closely.
    for (const v of r.values) expect(Math.abs(v)).toBeLessThan(5)
  })

  it('mixes messages logged at different rates', () => {
    // IMU runs several times faster than ATT; the expression still lines up.
    const r = evaluateExpression(real, 'sqrt(IMU.AccX^2 + IMU.AccY^2 + IMU.AccZ^2)')
    const mean = r.values.reduce((a, b) => a + b, 0) / r.values.length
    // The magnitude of gravity, whatever way up the accelerometers are.
    expect(mean).toBeGreaterThan(9)
    expect(mean).toBeLessThan(11)
  })

  it('converts units the way someone actually would', () => {
    const meters = getSeries(real, 'BARO', 'Alt')!
    const feet = evaluateExpression(real, 'BARO.Alt * 3.28084')
    expect(feet.values[10]).toBeCloseTo(meters.values[10]! * 3.28084, 6)
  })
})
