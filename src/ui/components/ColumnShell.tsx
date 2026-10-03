import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useCompact } from '../compact'
import { onOutsidePress } from './outside-press'

// A screen's side panel: its actions column. On the desktop it is the framed
// column beside the pane. In compact mode there is no room for it, so it
// floats over the pane, hanging under the row that holds the ColumnToggle
// that opens it. That row stays usable: the button closes the panel again, and
// a screen's Write beside it stays in reach. Every screen with a column uses this, so
// the button and the panel look and sit the same everywhere.
//
// It stays mounted while closed, because its buttons own hidden file inputs
// and dialogs that must outlive a click. A screen may have a panel on each
// side (Log Review's fields and actions); they are told apart by name, and
// one is open at a time.

const usePanels = create<{ open: string | null; setOpen: (open: string | null) => void }>(
  (set) => ({
    open: null,
    setOpen: (open) => set({ open }),
  }),
)

const ACTIONS = 'actions'

/** Whether the named panel is open. */
export function useColumnOpen(name: string = ACTIONS): boolean {
  return usePanels((s) => s.open === name)
}

/** Closes a panel from code, such as when another panel opens in its place. */
export function closeColumn(name: string = ACTIONS): void {
  if (usePanels.getState().open === name) usePanels.getState().setOpen(null)
}

/** Opens a panel from code, such as when a selection has detail to show. */
export function openColumn(name: string = ACTIONS): void {
  usePanels.getState().setOpen(name)
}

/** The button that opens and closes a panel, in compact mode only. */
export function ColumnToggle({
  target = ACTIONS,
  side = 'right',
  label = 'Side panel',
  alert = false,
}: {
  target?: string
  side?: 'left' | 'right'
  /** What the panel holds, for its accessible name. */
  label?: string
  /** Something in the closed panel needs seeing (a transfer, a failure). */
  alert?: boolean
}) {
  const compact = useCompact()
  const open = useColumnOpen(target)
  const setOpen = usePanels((s) => s.setOpen)
  if (!compact) return null
  return (
    <button
      type="button"
      className={`app-panel-toggle${open ? ' is-on' : ''}${alert && !open ? ' has-alert' : ''}`}
      aria-label={label}
      aria-pressed={open}
      title={label}
      data-column-toggle={target}
      onClick={() => setOpen(open ? null : target)}
    >
      {/* A window with the panel's side filled in. */}
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
        {side === 'right' ? (
          <path
            className="app-panel-toggle__pane"
            d="M12 3.5h3.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H12z"
          />
        ) : (
          <path
            className="app-panel-toggle__pane"
            d="M8 3.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8z"
          />
        )}
      </svg>
    </button>
  )
}

export default function ColumnShell({
  name = ACTIONS,
  side = 'right',
  base = 'app-col-shell',
  floats = true,
  children,
}: {
  /** Which panel this is, where a screen has two. */
  name?: string
  side?: 'left' | 'right'
  /** The column's own class, which draws its frame. */
  base?: string
  /** False keeps the column in the layout in compact mode too. */
  floats?: boolean
  children: ReactNode
}) {
  const compact = useCompact()
  const open = useColumnOpen(name)
  const setOpen = usePanels((s) => s.setOpen)
  const ref = useRef<HTMLElement>(null)
  const floating = floats && compact
  // Just under the button that opened it.
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!floating || !open) return
    // Never above the app bar, should the button scroll up out of view.
    const place = () => {
      const btn = document.querySelector(`[data-column-toggle="${name}"]`)
      const bar = document.querySelector('.la-appbar')?.getBoundingClientRect().bottom ?? 0
      setTop(btn ? Math.max(bar, btn.getBoundingClientRect().bottom) : null)
    }
    place()
    window.addEventListener('resize', place)
    // Capture, since the page scrolls inside the screen, not the window.
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [floating, open, name])

  // A panel the screen stops using closes (Log Review's actions once its
  // log is closed), rather than reappearing open when it is used again.
  useEffect(() => {
    if (!floating && usePanels.getState().open === name) setOpen(null)
  }, [floating, name, setOpen])

  // Leaving the screen closes it, so the next screen opens with its pane.
  useEffect(
    () => () => {
      if (usePanels.getState().open === name) setOpen(null)
    },
    [name, setOpen],
  )

  // A press outside the panel (see outside-press.ts) or Escape closes it.
  useEffect(() => {
    if (!floating || !open) return
    const offPress = onOutsidePress(
      (t) =>
        !!ref.current?.contains(t) ||
        !!t.closest('[data-column-toggle]') ||
        // A dialog opened from the panel is part of it wherever it renders.
        !!t.closest('.la-modal') ||
        // A map marker (a rally point, a fence shape) selects what the panel
        // shows.
        !!t.closest('.leaflet-marker-icon'),
      () => setOpen(null),
    )
    const onKey = (e: KeyboardEvent) => {
      // Escape answers a dialog opened from the panel first.
      if (e.key === 'Escape' && !document.querySelector('.la-modal:not(.hidden)')) setOpen(null)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      offPress()
      document.removeEventListener('keydown', onKey)
    }
  }, [floating, open, setOpen])

  return (
    <aside
      ref={ref}
      className={[
        base,
        floats ? `app-side-panel app-side-panel--${side}` : '',
        floating && open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={floating && open && top !== null ? { top } : undefined}
    >
      {children}
    </aside>
  )
}
