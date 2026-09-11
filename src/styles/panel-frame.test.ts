import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The panel frame is copied, not shared, and this is the brake on that.
//
// Three lines make a panel in this app -- a hairline border, the small
// radius, and the surface color -- and CSS has no way to say "the same as
// that one". So they get pasted, and a screen that pastes them into its own
// class has quietly opted out of every later change to what a panel looks
// like. That is not hypothetical: the actions column had `.app-col-shell`
// written for exactly this job and *nothing used it*, because Parameters and
// Mission had the three lines in `.params-aside, .mission-side`, OSD had
// them again in `.osd-actions`, and Logs and MAVFTP had no frame at all --
// so on Logs the left field list was framed and the right column was not, on
// one screen.
//
// This test does not forbid the copy. It pins the list, so adding one is a
// deliberate edit here rather than something that happens by paste, and
// whoever makes that edit reads this comment first.
//
// **Before adding a selector: is it an actions column?** Then it wants
// `.app-col-shell` around an `.app-col` and belongs in neither this list nor
// a class of its own. Is it a main pane -- the thing a column sits beside?
// Then it is one of the panes below and the list grows by one. Is it a card?
// `.la-card` already exists.

const CSS = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8')

/** Selectors allowed to draw the panel frame themselves. */
const ALLOWED = [
  // The one shared definition. Every actions column composes this.
  '.app-col-shell',
  // Main panes: the scrolling body a column sits beside.
  '.files__scroll',
  '.inspector__scroll',
  '.log-main',
  // The parameters pane, not its scroll box: the search and the count sit
  // inside the frame with the table so the panel is the full height of the
  // screen and matches the actions column beside it.
  '.params-pane',
  // Panes that are not beside a column but are the same kind of surface.
  '.app-doc',
  '.flight-controls',
  '.log-fields',
  '.log-pane',
  '.mission-lower',
  '.plot-panel',
  // Repeated items *inside* a panel, which are framed to separate them from
  // it rather than to be one.
  '.fence-item',
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
    // The three that had it and no longer do. Each is now `.app-col-shell`
    // in the markup; a regression here means someone re-pasted the frame.
    for (const sel of ['.params-aside', '.mission-side', '.osd-actions']) {
      expect(framedSelectors(CSS)).not.toContain(sel)
    }
  })

  it('finds the frame at all', () => {
    // Guards the matcher itself: if the trio is ever reworded, every
    // assertion above passes over an empty list and proves nothing.
    expect(framedSelectors(CSS).length).toBeGreaterThan(5)
    expect(framedSelectors(CSS)).toContain('.app-col-shell')
  })
})

// The other half of the same rule, checked from the markup side.
//
// The frame allowlist above stops a screen pasting the trio into a class of
// its own. It cannot stop the opposite mistake -- rendering a bare `.app-col`
// and getting no frame at all -- which is how the Inspector's detail column
// and, before them, Logs and MAVFTP ended up unframed next to framed panes.

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
