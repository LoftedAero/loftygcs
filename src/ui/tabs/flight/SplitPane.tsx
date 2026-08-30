import { useEffect, useRef, useState, type ReactNode } from 'react'

// The draggable divider between the two flight columns. Hand-rolled rather
// than pulled from a library: it is about seventy lines, and a library's
// divider would arrive with its own colors and hit areas to override back
// into the design system.
//
// The drag is tracked on the window rather than through setPointerCapture --
// this screen re-renders at telemetry rate, and re-binding a captured pointer
// on every one of those renders wedges the input pipeline.

export interface SplitPaneProps {
  /** Fraction of the width taken by the first column. */
  ratio: number
  onRatio: (r: number) => void
  first: ReactNode
  second: ReactNode
  /** With one column hidden the survivor fills, and no divider is drawn. */
  only?: 'first' | 'second' | undefined
}

export default function SplitPane({ ratio, onRatio, first, second, only }: SplitPaneProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const onRatioRef = useRef(onRatio)
  onRatioRef.current = onRatio

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const box = boxRef.current?.getBoundingClientRect()
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
  }, [dragging])

  if (only) {
    return (
      <div className="split split--single" ref={boxRef}>
        <div className="split__slot">{only === 'first' ? first : second}</div>
      </div>
    )
  }

  return (
    <div className="split" ref={boxRef}>
      <div className="split__slot" style={{ width: `${(ratio * 100).toFixed(2)}%` }}>
        {first}
      </div>
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
      <div className="split__slot split__slot--rest">{second}</div>
    </div>
  )
}
