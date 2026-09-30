// Dismissing a floating panel by pressing outside it, shared by the side
// panel (ColumnShell) and the app bar's panels (BarPopover).
//
// Pointer events rather than mouse ones: on a touch screen mousedown is a
// compatibility event, sent late and not at all if a handler cancels the
// pointer. Capture phase, so a control that stops propagation (Leaflet
// does) still counts.
//
// A press on the map that closes a panel is a dismissal, not a map tap: the
// click that follows is swallowed, or it would place a waypoint or a rally
// point. Presses on other controls act as well as close.

/** How long after the press its click can arrive. */
const CLICK_WINDOW_MS = 600

function swallowNextClick(): void {
  const eat = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
    done()
  }
  const done = () => {
    document.removeEventListener('click', eat, true)
    clearTimeout(timer)
  }
  document.addEventListener('click', eat, true)
  const timer = setTimeout(done, CLICK_WINDOW_MS)
}

/**
 * Calls `close` on a press outside `isInside`, and returns the cleanup.
 * Presses on the map are swallowed as described above.
 */
export function onOutsidePress(isInside: (t: Element) => boolean, close: () => void): () => void {
  const down = (e: PointerEvent) => {
    const t = e.target as Element | null
    if (!t || isInside(t)) return
    if (t.closest('.leaflet-container') && !t.closest('.leaflet-control')) swallowNextClick()
    close()
  }
  document.addEventListener('pointerdown', down, true)
  return () => document.removeEventListener('pointerdown', down, true)
}
