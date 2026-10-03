import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onOutsidePress } from '../components/outside-press'

// A button in the app bar that opens a panel of detail beneath it (compact
// mode's status items). As with the SITL tray, the panel is portaled to the
// body and placed from the button's rect, because `.la-appbar` is a stacking
// context that would cap it below Leaflet's controls.

export default function BarPopover({
  className,
  panelClassName,
  label,
  title,
  button,
  children,
  onToggle,
  buttonProps,
}: {
  className: string
  /** Added to the panel's own class, for a panel laid out differently. */
  panelClassName?: string
  /** The panel's accessible name. */
  label: string
  title?: string
  button: ReactNode
  /** The panel's content; a function so it can close the panel. */
  children: (close: () => void) => ReactNode
  /** Told when the panel opens or closes. */
  onToggle?: (open: boolean) => void
  /** Extra attributes for the button, such as a role it plays in a group. */
  buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>
}) {
  const [open, setOpenState] = useState(false)
  const toggleRef = useRef(onToggle)
  toggleRef.current = onToggle
  const setOpen = (next: boolean) => {
    setOpenState(next)
    toggleRef.current?.(next)
  }
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Viewport coordinates, since the panel is portaled.
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  // Under the button, kept inside the window.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = btn.current?.getBoundingClientRect()
      const w = panel.current?.offsetWidth ?? 0
      if (!r) return
      const margin = 8
      const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin)
      setAt({ top: r.bottom + margin / 2, left })
    }
    place()
    // Once more after the panel has a width to keep inside the window.
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Dismiss on a press outside (see outside-press.ts) and on Escape.
  useEffect(() => {
    if (!open) return
    const offPress = onOutsidePress(
      (t) => !!btn.current?.contains(t) || !!panel.current?.contains(t),
      () => setOpen(false),
    )
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      offPress()
      document.removeEventListener('keydown', onKey)
    }
    // setOpen only wraps the state setter and a ref, so it is not a dependency.
  }, [open])

  return (
    <>
      <button
        {...buttonProps}
        ref={btn}
        type="button"
        className={`${className}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        onClick={() => setOpen(!open)}
      >
        {button}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className={panelClassName ? `bar-pop ${panelClassName}` : 'bar-pop'}
            role="dialog"
            aria-label={label}
            style={at ? { top: at.top, left: at.left } : { visibility: 'hidden' }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  )
}
