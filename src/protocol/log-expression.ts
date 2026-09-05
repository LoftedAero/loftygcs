// Plotting something the log does not record.
//
// "ATT.DesRoll - ATT.Roll" is the tracking error, "sqrt(IMU.AccX^2 +
// IMU.AccY^2)" is lateral acceleration, "BARO.Alt * 3.28084" is feet. None
// of them is a field, all of them are questions people ask of a log, and
// plot.ardupilot.org lets you type them.
//
// A parser rather than eval(). Not only because eval on a string from a
// file would be a hole, but because eval cannot see `ATT.Roll` as a
// reference to resample -- the whole job here is turning names into series
// and lining their timestamps up.
//
// Series arrive at different rates: ATT at 10 Hz, IMU at 50, GPS at 5.
// Every expression is evaluated on the time base of its *first* reference,
// with the others sampled onto it. First rather than fastest, because the
// leading term is what the reader was thinking in -- and interpolating a
// slow signal up is honest where decimating a fast one hides what it did
// between samples.

import { getSeries, type ParsedLog, type Series } from './dataflash'

export interface ExpressionResult {
  time: Float64Array
  values: Float64Array
  /** Every MESSAGE.field the expression referenced, in order of first use. */
  references: string[]
}

export class ExpressionError extends Error {}

// ---------------------------------------------------------------- lexing

type Token =
  | { t: 'num'; v: number }
  | { t: 'ref'; v: string }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: '('; }
  | { t: ')'; }
  | { t: ','; }

/** Functions an expression may call, all elementwise. */
const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  min: Math.min,
  max: Math.max,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  log: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  /** Degrees from radians and back, since half of ArduPilot is one and half the other. */
  deg: (r: number) => (r * 180) / Math.PI,
  rad: (d: number) => (d * Math.PI) / 180,
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

function lex(source: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(source.slice(i))
      if (!m) throw new ExpressionError(`Bad number at position ${i}.`)
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      // A name, optionally MESSAGE.field. Message names are upper case with
      // digits (XKF1, ESCX); fields are mixed (DesRoll, C1).
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(source.slice(i))!
      const word = m[0]
      i += word.length
      if (word.includes('.')) out.push({ t: 'ref', v: word })
      else if (word.toLowerCase() in CONSTANTS)
        out.push({ t: 'num', v: CONSTANTS[word.toLowerCase()]! })
      else if (word.toLowerCase() in FUNCTIONS) out.push({ t: 'fn', v: word.toLowerCase() })
      else throw new ExpressionError(`Unknown name "${word}". Fields are written MESSAGE.Field.`)
      continue
    }
    if ('+-*/^%'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    if (c === '(') {
      out.push({ t: '(' })
      i++
      continue
    }
    if (c === ')') {
      out.push({ t: ')' })
      i++
      continue
    }
    if (c === ',') {
      out.push({ t: ',' })
      i++
      continue
    }
    throw new ExpressionError(`Unexpected character "${c}".`)
  }
  return out
}

// --------------------------------------------------------------- parsing

type Node =
  | { n: 'num'; v: number }
  | { n: 'ref'; v: string }
  | { n: 'neg'; a: Node }
  | { n: 'bin'; op: string; a: Node; b: Node }
  | { n: 'call'; fn: string; args: Node[] }

/**
 * Recursive descent, lowest precedence first.
 *
 * `^` binds tighter than unary minus and is right-associative, so -2^2 is
 * -4 and 2^3^2 is 512 -- the conventions a spreadsheet uses, which is what
 * anyone typing here will expect.
 */
function parse(tokens: Token[]): Node {
  let at = 0
  const peek = () => tokens[at]
  const eat = () => tokens[at++]

  const expression = (): Node => additive()

  const additive = (): Node => {
    let left = multiplicative()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        eat()
        left = { n: 'bin', op: t.v, a: left, b: multiplicative() }
      } else return left
    }
  }

  const multiplicative = (): Node => {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        eat()
        left = { n: 'bin', op: t.v, a: left, b: unary() }
      } else return left
    }
  }

  const unary = (): Node => {
    const t = peek()
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      eat()
      const operand = unary()
      return t.v === '-' ? { n: 'neg', a: operand } : operand
    }
    return power()
  }

  const power = (): Node => {
    const base = primary()
    const t = peek()
    if (t?.t === 'op' && t.v === '^') {
      eat()
      // Right-associative, and its exponent may itself be negated.
      return { n: 'bin', op: '^', a: base, b: unary() }
    }
    return base
  }

  const primary = (): Node => {
    const t = eat()
    if (!t) throw new ExpressionError('The expression ends too early.')
    if (t.t === 'num') return { n: 'num', v: t.v }
    if (t.t === 'ref') return { n: 'ref', v: t.v }
    if (t.t === 'fn') {
      if (peek()?.t !== '(') throw new ExpressionError(`${t.v} needs brackets: ${t.v}(...)`)
      eat()
      const args: Node[] = []
      if (peek()?.t !== ')') {
        for (;;) {
          args.push(expression())
          if (peek()?.t === ',') {
            eat()
            continue
          }
          break
        }
      }
      if (eat()?.t !== ')') throw new ExpressionError(`${t.v} is missing its closing bracket.`)
      return { n: 'call', fn: t.v, args }
    }
    if (t.t === '(') {
      const inner = expression()
      if (eat()?.t !== ')') throw new ExpressionError('Missing a closing bracket.')
      return inner
    }
    throw new ExpressionError('Expected a number, a field, or a bracket.')
  }

  const tree = expression()
  if (at < tokens.length) throw new ExpressionError('Unexpected trailing input.')
  return tree
}

/** Every MESSAGE.field the tree mentions, in order of first appearance. */
function referencesOf(node: Node, into: string[] = []): string[] {
  switch (node.n) {
    case 'ref':
      if (!into.includes(node.v)) into.push(node.v)
      return into
    case 'neg':
      return referencesOf(node.a, into)
    case 'bin':
      referencesOf(node.a, into)
      return referencesOf(node.b, into)
    case 'call':
      for (const a of node.args) referencesOf(a, into)
      return into
    default:
      return into
  }
}

// ------------------------------------------------------------ evaluating

/** Value of a series at a time, linearly between samples, held at the ends. */
function sampleAt(s: Series, t: number, hint: number): { value: number; index: number } {
  const time = s.time
  if (time.length === 0) return { value: NaN, index: 0 }
  let i = hint
  if (i >= time.length) i = time.length - 1
  while (i > 0 && time[i]! > t) i--
  while (i + 1 < time.length && time[i + 1]! <= t) i++
  if (t <= time[0]!) return { value: s.values[0]!, index: 0 }
  if (t >= time[time.length - 1]!) return { value: s.values[time.length - 1]!, index: i }
  const t0 = time[i]!
  const t1 = time[i + 1]!
  const v0 = s.values[i]!
  if (t1 <= t0) return { value: v0, index: i }
  return { value: v0 + ((s.values[i + 1]! - v0) * (t - t0)) / (t1 - t0), index: i }
}

/**
 * Evaluate an expression across a log.
 *
 * Throws ExpressionError with something a person can act on: the message
 * goes straight into the field under the input box, so "Unknown name" beats
 * "unexpected token" every time.
 */
export function evaluateExpression(log: ParsedLog, source: string): ExpressionResult {
  const text = source.trim()
  if (!text) throw new ExpressionError('Type an expression, like ATT.DesRoll - ATT.Roll.')
  const tree = parse(lex(text))
  const references = referencesOf(tree)
  if (references.length === 0) {
    throw new ExpressionError('That has no fields in it, so there is nothing to plot.')
  }

  const series = new Map<string, Series>()
  for (const ref of references) {
    const dot = ref.indexOf('.')
    const message = ref.slice(0, dot)
    const field = ref.slice(dot + 1)
    const s = getSeries(log, message, field)
    if (!s) throw new ExpressionError(`This log has no ${ref}.`)
    series.set(ref, s)
  }

  // The first reference sets the timeline; see the note at the top.
  const base = series.get(references[0]!)!
  const time = base.time
  const values = new Float64Array(time.length)
  const hints = new Map<string, number>(references.map((r) => [r, 0]))

  const baseRef = references[0]!
  for (let i = 0; i < time.length; i++) {
    const t = time[i]!
    const at = new Map<string, number>()
    for (const ref of references) {
      if (ref === baseRef) {
        // The timeline's own series is read straight off, not resampled.
        // Interpolating a series onto its own timestamps is a no-op only
        // while they are strictly increasing -- and they are not: a vehicle
        // with two barometers logs both instances into one BARO series at
        // the same microsecond, and resampling there returned a neighbour's
        // value instead of this row's.
        at.set(ref, base.values[i]!)
        continue
      }
      const s = series.get(ref)!
      const { value, index } = sampleAt(s, t, hints.get(ref)!)
      hints.set(ref, index)
      at.set(ref, value)
    }
    values[i] = evaluate(tree, at)
  }

  return { time, values, references }
}

function evaluate(node: Node, at: ReadonlyMap<string, number>): number {
  switch (node.n) {
    case 'num':
      return node.v
    case 'ref':
      return at.get(node.v) ?? NaN
    case 'neg':
      return -evaluate(node.a, at)
    case 'bin': {
      const a = evaluate(node.a, at)
      const b = evaluate(node.b, at)
      switch (node.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        // Division by zero gives Infinity rather than throwing: one bad
        // sample should leave a gap in a trace, not lose the whole plot.
        case '/':
          return a / b
        case '%':
          return a % b
        case '^':
          return a ** b
        default:
          return NaN
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.fn]!
      return fn(...node.args.map((a) => evaluate(a, at)))
    }
  }
}

/** Check an expression without evaluating it. Returns the problem, or null. */
export function expressionError(log: ParsedLog, source: string): string | null {
  try {
    const tree = parse(lex(source.trim()))
    for (const ref of referencesOf(tree)) {
      const dot = ref.indexOf('.')
      if (!getSeries(log, ref.slice(0, dot), ref.slice(dot + 1))) {
        return `This log has no ${ref}.`
      }
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
