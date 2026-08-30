import { useEffect, useRef, useState, type RefObject } from 'react'

// The draggable column divider. Hand-rolled rather than pulled from a
// library: it is about sixty lines, and a library's divider would arrive
// with its own colors and hit areas to override back into the design system.
//
// The drag is tracked on the window rather than through setPointerCapture --
// this screen re-renders at telemetry rate, and re-binding a captured pointer
// on every one of those renders wedges the input pipeline.

export interface DividerProps {
  /** The box the fraction is measured against. */
  containerRef: RefObject<HTMLElement | null>
  ratio: number
  onRatio: (r: number) => void
}

export default function Divider({ containerRef, ratio, onRatio }: DividerProps) {
  const [dragging, setDragging] = useState(false)
  const onRatioRef = useRef(onRatio)
  onRatioRef.current = onRatio

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const box = containerRef.current?.getBoundingClientRect()
      if (!box || !box.width) return
      const f = (e.clientX - box.left) / box.width
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
  }, [dragging, containerRef])

  return (
    <div
      className={`split__divider${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(ratio * 100)}
      aria-label="Resize panels"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onKeyDown={(e) => {
        // Keyboard resize, because a pointer-only divider is unusable to
        // anyone driving the app from the keyboard.
        const step = e.shiftKey ? 0.1 : 0.02
        if (e.key === 'ArrowLeft') onRatio(ratio - step)
        else if (e.key === 'ArrowRight') onRatio(ratio + step)
        else return
        e.preventDefault()
      }}
    />
  )
}
