import { useSyncExternalStore } from 'react'
import { usePreferencesStore } from '../stores/preferences-store'

// Compact mode: a window too small for the desktop layout, such as a handheld
// ground station (the Radiomaster AX12 gives the app 732×412), a phone or a
// small laptop window. Chosen by size rather than by device, so the web app
// gets it too, unless Preferences fixes it either way. App marks the root
// element with `data-compact`, which app.css's compact rules key on.
export const COMPACT_QUERY = '(max-width: 800px), (max-height: 480px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY)
    : null
}

function subscribe(onChange: () => void): () => void {
  const q = query()
  q?.addEventListener('change', onChange)
  return () => q?.removeEventListener('change', onChange)
}

/** Whether to use the compact layout; re-renders when that changes. */
export function useCompact(): boolean {
  const choice = usePreferencesStore((s) => s.layout)
  const small = useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  )
  return choice === 'compact' || (choice === 'auto' && small)
}
