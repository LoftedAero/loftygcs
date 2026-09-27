import { useEffect, useRef, useState, type RefObject } from 'react'

// The draggable panel divider.
//
// The drag is tracked on the window rather than with setPointerCapture: the
// screen re-renders at telemetry rate, and re-binding a captured pointer on
// every render wedges the input pipeline.

export interface DividerProps {
  /** The box the fraction is measured against. */
  containerRef: RefObject<HTMLElement | null>
  ratio: number
  onRatio: (r: number) => void
  /**
   * The separator's own orientation, in the ARIA sense: `vertical` divides
   * left from right and drags sideways; `horizontal` divides top from bottom.
   */
  orientation?: 'vertical' | 'horizontal'
}

export default function Divider({
  containerRef,
  ratio,
  onRatio,
  orientation = 'vertical',
}: DividerProps) {
  const vertical = orientation === 'vertical'
  const [dragging, setDragging] = useState(false)
  const onRatioRef = useRef(onRatio)
  onRatioRef.current = onRatio

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const box = containerRef.current?.getBoundingClientRect()
      if (!box) return
      const span = vertical ? box.width : box.height
      if (!span) return
      const f = vertical ? (e.clientX - box.left) / span : (e.clientY - box.top) / span
      if (Number.isFinite(f)) onRatioRef.current(f)
    }
    const stop = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    // While dragging over the map, Leaflet must not also see the pointer.
    document.body.classList.add('is-splitting')
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('is-splitting')
    }
  }, [dragging, containerRef, vertical])

  return (
    <div
      className={`split__divider split__divider--${orientation}${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation={orientation}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label="Resize panels"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onKeyDown={(e) => {
        // Keyboard resize; Shift takes bigger steps.
        const step = e.shiftKey ? 0.1 : 0.02
        const less = vertical ? 'ArrowLeft' : 'ArrowUp'
        const more = vertical ? 'ArrowRight' : 'ArrowDown'
        if (e.key === less) onRatio(ratio - step)
        else if (e.key === more) onRatio(ratio + step)
        else return
        e.preventDefault()
      }}
    />
  )
}
