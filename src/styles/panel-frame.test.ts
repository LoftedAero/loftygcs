import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The panel frame (hairline border, small radius, surface color) has to be
// repeated in CSS, and a class that pastes it opts out of later changes to
// how panels look. This pins the list of selectors allowed to draw it, so
// adding one is a deliberate edit.
//
// Before adding a selector: an actions column should use `.app-col-shell`
// around an `.app-col` instead. A main pane (what a column sits beside)
// belongs in the list. A card should use `.la-card`.

const CSS = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

/** Selectors allowed to draw the panel frame themselves. */
const ALLOWED = [
  // The one shared definition. Every actions column composes this.
  '.app-col-shell',
  // Main panes: the scrolling body a column sits beside.
  '.files__pane',
  '.inspector__pane',
  '.log-main',
  // The pane, not its scroll box: the search and count sit inside the frame
  // so it spans the screen's full height beside the actions column.
  '.params-pane',
  // Panes that are not beside a column but are the same kind of surface.
  '.flight-controls',
  '.log-fields',
  '.log-pane',
  '.mission-lower',
  '.plot-panel',
  // Repeated items inside a panel, framed to separate them from it.
  '.fence-item',
  // Configuration's frame picker; the chosen tile is marked by border color.
  '.frame-tile',
  '.fw-vehicle',
  '.plotted',
  '.preset__load',
]

/** Every selector whose own body draws border + radius + surface. */
function framedSelectors(css: string): string[] {
  const found: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2] ?? ''
    if (
      !body.includes('border: 1px solid var(--la-line)') ||
      !body.includes('background: var(--la-surface)')
    ) {
      continue
    }
    // Strip any comment sitting between the previous rule and this selector.
    const sel = (m[1] ?? '').split('*/').pop() ?? ''
    found.push(sel.split(/\s+/).filter(Boolean).join(' '))
  }
  return found
}

describe('the panel frame', () => {
  it('is drawn only by selectors that have been signed off', () => {
    const found = framedSelectors(CSS)
    expect([...new Set(found)].sort()).toEqual([...ALLOWED].sort())
  })

  it('is not drawn by a class that should be composing the shell', () => {
    // These use `.app-col-shell` in the markup instead.
    for (const sel of ['.params-aside', '.mission-side', '.osd-actions']) {
      expect(framedSelectors(CSS)).not.toContain(sel)
    }
  })

  it('finds the frame at all', () => {
    // Guards the matcher: if the CSS is reworded, the assertions above would
    // pass over an empty list.
    expect(framedSelectors(CSS).length).toBeGreaterThan(5)
    expect(framedSelectors(CSS)).toContain('.app-col-shell')
  })
})

// The markup side of the same rule: a bare `.app-col` without its shell
// renders with no frame at all.

const UI = join(process.cwd(), 'src/ui')

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsxFiles(full))
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

/** `app-col` as a container class, not `app-col__group` and friends. */
const COLUMN = /className="[^"]*\bapp-col\b(?!__|-shell)/
const SHELL = /\bapp-col-shell\b/

/**
 * The one file allowed to render a column without its shell, because the
 * shell is supplied by the screen that renders it.
 */
const SHELL_SUPPLIED_ELSEWHERE = ['tabs/params/ParamSidebar.tsx']

describe('every actions column has a shell', () => {
  it('renders no bare .app-col', () => {
    const offenders = tsxFiles(UI)
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return COLUMN.test(src) && !SHELL.test(src)
      })
      .map((f) => relative(UI, f).split(sep).join('/'))
    expect(offenders).toEqual(SHELL_SUPPLIED_ELSEWHERE)
  })

  it('still finds the columns it is checking', () => {
    // Guards the matcher: a regex that matches nothing would let every
    // assertion above pass over an empty list.
    const withColumns = tsxFiles(UI).filter((f) => COLUMN.test(readFileSync(f, 'utf8')))
    expect(withColumns.length).toBeGreaterThan(4)
  })
})
