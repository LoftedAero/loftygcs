import { create } from 'zustand'

// Light, dark, or whatever the machine says.
//
// The choice is resolved to an explicit `data-theme` on <html> here rather
// than left to `prefers-color-scheme` in the stylesheet. One reason: the
// palette then exists once in app.css, under one selector, instead of being
// duplicated into a media query where the two copies drift. The other: an
// explicit choice has to beat the OS in both directions, which in pure CSS
// takes three blocks to express and one to get wrong.
//
// A matching inline script in index.html applies the same attribute before
// first paint, so the window does not flash white on the way to dark.

export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'loftgcs.theme'

function load(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Private mode, or storage disabled: the default is a fine answer.
  }
  return 'system'
}

function systemPrefers(): ResolvedTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemPrefers() : choice
}

/**
 * Stamps the document. `color-scheme` is the half that is easy to forget and
 * obvious when missing: it is what makes scrollbars, select popups and other
 * browser-drawn furniture dark, none of which our stylesheet can reach.
 */
function apply(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
}

export interface ThemeState {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice(choice: ThemeChoice): void
  /** Light ⇄ dark, landing on an explicit choice either way. */
  toggle(): void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  choice: load(),
  resolved: resolveTheme(load()),

  setChoice(choice) {
    const resolved = resolveTheme(choice)
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Not being able to remember it is not a reason to refuse the change.
    }
    apply(resolved)
    set({ choice, resolved })
  },

  toggle() {
    get().setChoice(get().resolved === 'dark' ? 'light' : 'dark')
  },
}))

/** Follow the OS while the choice is "system". Called once, at startup. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const { choice } = useThemeStore.getState()
    if (choice !== 'system') return
    const resolved = resolveTheme('system')
    apply(resolved)
    useThemeStore.setState({ resolved })
  }
  mq.addEventListener('change', onChange)
  // The inline script ran before the store existed; make sure the two agree.
  onChange()
  apply(useThemeStore.getState().resolved)
  return () => mq.removeEventListener('change', onChange)
}
