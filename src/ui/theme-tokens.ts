// Design tokens, resolved for canvas drawing.
//
// Canvas has no var(): every color has to reach it as a string, so the
// tokens must be read out of the document. Doing that inside a draw call
// forces a style recalculation, which at sixty frames a second on several
// instruments is real work for a value that changes about twice a year.
//
// So the values are read once and kept, keyed on the theme attribute --
// reading one attribute per frame is free, and the cache refills by itself
// the moment the theme changes, with nothing to subscribe or unsubscribe.

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
 * has loaded and in jsdom, where computed custom properties come back empty
 * -- a drawing routine should never have to care which.
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
