import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Disabled controls never show the not-allowed cursor. The design system
// sets it and is frozen, so app.css overrides it; this reads both sheets so a
// new `not-allowed` in the next copy of the design system fails here.

const read = (f: string) => readFileSync(join(process.cwd(), 'src/styles', f), 'utf8')
const SHEET = read('lofted-aero.css')
const APP = read('app.css')

/** Every selector in a sheet whose rule sets the given declaration. */
function selectorsSetting(css: string, declaration: RegExp): string[] {
  const out: string[] = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (declaration.test(m[2] ?? '')) {
      for (const sel of (m[1] ?? '').split(',')) out.push(sel.trim())
    }
  }
  return out
}

describe('disabled controls', () => {
  it('get the default pointer wherever the design system gives them not-allowed', () => {
    const fromSheet = selectorsSetting(SHEET, /cursor:\s*not-allowed/)
    expect(fromSheet.length).toBeGreaterThan(0)
    const overridden = new Set(selectorsSetting(APP, /cursor:\s*default/))
    expect(fromSheet.filter((s) => !overridden.has(s))).toEqual([])
  })

  it('never get not-allowed from this app', () => {
    expect(selectorsSetting(APP, /cursor:\s*not-allowed/)).toEqual([])
  })
})
