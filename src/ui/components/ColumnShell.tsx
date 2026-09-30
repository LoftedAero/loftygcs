import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { useCompact } from '../compact'

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

const useDrawer = create<{ open: string | null; setOpen: (open: string | null) => void }>(
  (set) => ({
    open: null,
    setOpen: (open) => set({ open }),
  }),
)

const ACTIONS = 'actions'

/** Whether the named panel is open. */
export function useColumnOpen(name: string = ACTIONS): boolean {
  return useDrawer((s) => s.open === name)
}

/** Closes a panel from code, such as when another panel opens in its place. */
export function closeColumn(name: string = ACTIONS): void {
  if (useDrawer.getState().open === name) useDrawer.getState().setOpen(null)
}

/** Opens a panel from code, such as when a selection has detail to show. */
export function openColumn(name: string = ACTIONS): void {
  useDrawer.getState().setOpen(name)
}

/** The button that opens and closes a panel, in compact mode only. */
export function ColumnToggle({
  target = ACTIONS,
  side = 'right',
  label = 'Side panel',
}: {
  target?: string
  side?: 'left' | 'right'
  /** What the panel holds, for its accessible name. */
  label?: string
}) {
  const compact = useCompact()
  const open = useColumnOpen(target)
  const setOpen = useDrawer((s) => s.setOpen)
  if (!compact) return null
  return (
    <button
      type="button"
      className={`app-panel-toggle${open ? ' is-on' : ''}`}
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
  drawer = true,
  children,
}: {
  /** Which panel this is, where a screen has two. */
  name?: string
  side?: 'left' | 'right'
  /** The column's own class, which draws its frame. */
  base?: string
  /** False keeps the column in the layout in compact mode too. */
  drawer?: boolean
  children: ReactNode
}) {
  const compact = useCompact()
  const open = useColumnOpen(name)
  const setOpen = useDrawer((s) => s.setOpen)
  const ref = useRef<HTMLElement>(null)
  const floating = drawer && compact
  // Just under the button that opened it.
  const [top, setTop] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!floating || !open) return
    const place = () => {
      const btn = document.querySelector(`[data-column-toggle="${name}"]`)
      setTop(btn ? btn.getBoundingClientRect().bottom : null)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [floating, open, name])

  // Leaving the screen closes it, so the next screen opens with its pane.
  useEffect(
    () => () => {
      if (useDrawer.getState().open === name) setOpen(null)
    },
    [name, setOpen],
  )

  // A tap outside the panel or Escape closes it. Capture phase, as for the
  // bar's panels, so a control that stops propagation still counts.
  useEffect(() => {
    if (!floating || !open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || t.closest?.('[data-column-toggle]')) return
      // A dialog opened from the panel is part of it wherever it renders.
      if (t.closest?.('.la-modal')) return
      // So is the map's content on Plan, where tapping an item edits it here.
      if (t.closest?.('.leaflet-marker-icon')) return
      setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [floating, open, setOpen])

  return (
    <aside
      ref={ref}
      className={[
        base,
        drawer ? `app-drawer app-drawer--${side}` : '',
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
