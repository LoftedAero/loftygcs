// Design tokens, resolved for canvas drawing.
//
// Canvas has no var(), so colors are read from the document. Reading computed
// style in a draw call forces a style recalculation every frame, so values
// are cached per theme attribute and refilled when the theme changes.

const KEYS = [
  '--la-ink',
  '--la-ink-2',
  '--la-ink-3',
  '--la-line',
  '--la-line-strong',
  '--la-surface',
  '--la-surface-2',
  '--la-bg',
  '--la-orange',
  '--la-blue',
  '--la-ok',
  '--la-bad',
] as const

export type TokenName = (typeof KEYS)[number]

let cachedTheme: string | null = null
let cache: Partial<Record<TokenName, string>> = {}

function readAll(): Partial<Record<TokenName, string>> {
  const css = getComputedStyle(document.documentElement)
  const out: Partial<Record<TokenName, string>> = {}
  for (const k of KEYS) out[k] = css.getPropertyValue(k).trim()
  return out
}

/**
 * The current value of a token. The fallback is used before the stylesheet
 * has loaded and in jsdom, where computed custom properties are empty.
 */
export function token(name: TokenName, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const theme = document.documentElement.getAttribute('data-theme') ?? 'light'
  if (theme !== cachedTheme) {
    cachedTheme = theme
    cache = readAll()
  }
  return cache[name] || fallback
}
