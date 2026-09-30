import { useEffect, type ReactNode, type Ref } from 'react'

// Compact mode's sheet over a full-window view (Plan's items, Fly's panel):
// it rises from the bottom, so the view stays in sight above it, and its
// handle rides on its top edge to close it again. The row that holds the
// handle can carry the view's other bottom controls (Fly's Arm), which ride up
// with it and stay in reach. Only the row's controls and the sheet take
// touches; the view around them stays live, so a tap on the map never closes
// the sheet.

export default function BottomSheet({
  id,
  label,
  name,
  open,
  onOpen,
  align = 'center',
  row,
  handleRef,
  className,
  children,
}: {
  /** The sheet body's id, for the handle's aria-controls. */
  id: string
  /** The handle's text; without it the handle is the caret alone. */
  label?: ReactNode
  /** What the sheet holds, for a caret-only handle's accessible name. */
  name?: string
  open: boolean
  onOpen: (open: boolean) => void
  /** Where the handle sits: the middle, or the right where the middle is taken. */
  align?: 'center' | 'right'
  /** Other controls on the handle's row, placed by the screen. */
  row?: ReactNode
  handleRef?: Ref<HTMLButtonElement>
  className?: string
  children: ReactNode
}) {
  // Escape closes it, answering a dialog opened from it first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.la-modal:not(.hidden)')) onOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpen])

  return (
    <div
      className={['app-sheet', `app-sheet--${align}`, open ? 'is-open' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="app-sheet__row">
        {row}
        <button
          type="button"
          className={`app-sheet__handle${label ? '' : ' app-sheet__handle--caret'}`}
          ref={handleRef}
          {...(label ? {} : { 'aria-label': name, title: name })}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onOpen(!open)}
        >
          {label}
          <svg viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 5l4-4 4 4" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="app-sheet__body" id={id}>
          {children}
        </div>
      )}
    </div>
  )
}
