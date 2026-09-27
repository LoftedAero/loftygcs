import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** The margin a menu keeps from the window's edges. */
const EDGE = 8

/**
 * Where a menu opened at a pointer goes: at the pointer, pulled back inside
 * the window by its measured size.
 *
 * The menus used to subtract a guessed size (250 x 260) from the window. A
 * menu that grew a row, or a window short enough to matter, put its bottom
 * past the edge with nothing to say so. Measured after layout and before
 * paint, so the first frame is already in place.
 */
export function useMenuPlacement(
  point: { x: number; y: number },
  box: RefObject<HTMLElement | null>,
): CSSProperties {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const place = () => {
      const { width, height } = el.getBoundingClientRect()
      setPos({
        left: Math.max(EDGE, Math.min(point.x, window.innerWidth - width - EDGE)),
        top: Math.max(EDGE, Math.min(point.y, window.innerHeight - height - EDGE)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [point.x, point.y, box])
  // Unplaced for the one layout pass it takes to measure, never painted.
  return pos ?? { left: point.x, top: point.y, visibility: 'hidden' }
}
