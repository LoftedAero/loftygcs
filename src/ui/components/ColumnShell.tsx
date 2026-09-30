import { useEffect, useRef, type ReactNode } from 'react'
import { create } from 'zustand'
import { useCompact } from '../compact'
import { LaButton } from './La'

// A screen's actions column. On the desktop it is the framed column beside the
// pane. In compact mode there is no room for it, so it becomes a drawer over
// the pane, opened by ColumnToggle in the pane's toolbar. It stays mounted
// while closed, because its buttons own hidden file inputs and dialogs that
// must outlive a click.
//
// A screen may have a drawer on each side (Log Review's fields and actions);
// they are told apart by name, and one is open at a time.

const useDrawer = create<{ open: string | null; setOpen: (open: string | null) => void }>(
  (set) => ({
    open: null,
    setOpen: (open) => set({ open }),
  }),
)

const ACTIONS = 'actions'

/** Opens a drawer from the toolbar in compact mode; nothing on the desktop. */
export function ColumnToggle({
  label = 'More',
  target = ACTIONS,
}: {
  label?: string
  target?: string
}) {
  const compact = useCompact()
  const open = useDrawer((s) => s.open === target)
  const setOpen = useDrawer((s) => s.setOpen)
  if (!compact) return null
  return (
    <LaButton
      variant="ghost"
      className="app-col-toggle"
      aria-expanded={open}
      data-column-toggle=""
      onClick={() => setOpen(open ? null : target)}
    >
      {label}
    </LaButton>
  )
}

/** Opens the drawer from code, such as when a selection has detail to show. */
export function openColumn(target: string = ACTIONS): void {
  useDrawer.getState().setOpen(target)
}

export default function ColumnShell({
  name = ACTIONS,
  side = 'right',
  base = 'app-col-shell',
  drawer = true,
  children,
}: {
  /** Which drawer this is, where a screen has two. */
  name?: string
  side?: 'left' | 'right'
  /** The column's own class, which draws its frame. */
  base?: string
  /** False keeps the column in the layout in compact mode too. */
  drawer?: boolean
  children: ReactNode
}) {
  const compact = useCompact()
  const open = useDrawer((s) => s.open === name)
  const setOpen = useDrawer((s) => s.setOpen)
  const ref = useRef<HTMLElement>(null)

  // Leaving the screen closes it, so the next screen opens with its pane.
  useEffect(
    () => () => {
      if (useDrawer.getState().open === name) setOpen(null)
    },
    [name, setOpen],
  )

  // A tap outside the drawer or Escape closes it. Capture phase, as for the
  // bar's panels, so a control that stops propagation still counts.
  useEffect(() => {
    if (!compact || !open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || t.closest?.('[data-column-toggle]')) return
      // A dialog opened from the column is part of it wherever it renders.
      if (t.closest?.('.la-modal')) return
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
  }, [compact, open, setOpen])

  return (
    <aside
      ref={ref}
      className={[
        base,
        drawer ? `app-drawer app-drawer--${side}` : '',
        drawer && compact && open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </aside>
  )
}
