import { create } from 'zustand'

// Light, dark, or follow the system.
//
// The choice is resolved to an explicit `data-theme` on <html> rather than
// left to `prefers-color-scheme`, so the dark palette exists once in app.css
// and an explicit choice overrides the OS in either direction.
//
// An inline script in index.html applies the same attribute before first
// paint, so the window does not flash white.

export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'loftgcs.theme'

function load(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage unavailable: use the default.
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
 * Applies the theme to the document. `color-scheme` is what darkens
 * scrollbars, select popups and other browser-drawn controls.
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
      // Apply the change even if it cannot be persisted.
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
