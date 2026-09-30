import { useEffect, useRef, useState } from 'react'

// Slide to confirm, for commands given on a touch screen: a tap can land by
// accident on a handheld, a deliberate drag across the track cannot.
//
// The drag follows window pointer events rather than pointer capture, which
// wedges automated pointer input on components under a telemetry-rate parent.

/** Unanswered, the slider withdraws, so a stale confirmation is never left armed. */
const TIMEOUT_MS = 10000
/** How far along the track counts as confirmed. */
const DONE_AT = 0.9
/** Keyboard steps across the track. */
const KEY_STEP = 0.25

export default function SlideConfirm({
  label,
  danger = false,
  onConfirm,
  onCancel,
}: {
  label: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  // 0..1 along the track.
  const [pos, setPos] = useState(0)
  const [dragging, setDragging] = useState(false)

  // The parent re-renders with telemetry; a ref keeps the timeout from
  // restarting with every new callback.
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    const t = setTimeout(() => cancelRef.current(), TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => knob.current?.focus(), [])

  const span = () => {
    const tr = track.current?.clientWidth ?? 0
    const kn = knob.current?.offsetWidth ?? 0
    return Math.max(1, tr - kn)
  }

  const finish = (at: number) => {
    if (at >= DONE_AT) {
      setPos(1)
      onConfirm()
    } else {
      setPos(0)
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startPos = pos
    const width = span()
    let at = startPos
    setDragging(true)
    const move = (ev: PointerEvent) => {
      at = Math.min(1, Math.max(0, startPos + (ev.clientX - startX) / width))
      setPos(at)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDragging(false)
      finish(at)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    } else if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault()
      const next = e.key === 'End' ? 1 : Math.min(1, pos + KEY_STEP)
      setPos(next)
      if (next >= 1) finish(next)
    } else if (e.key === 'ArrowLeft' || e.key === 'Home') {
      e.preventDefault()
      setPos(e.key === 'Home' ? 0 : Math.max(0, pos - KEY_STEP))
    }
  }

  return (
    <div className={`slide-confirm${danger ? ' slide-confirm--danger' : ''}`}>
      <div className="slide-confirm__track" ref={track}>
        <span className="slide-confirm__label">{label}</span>
        <div
          ref={knob}
          className={`slide-confirm__knob${dragging ? ' is-dragging' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos * 100)}
          style={{ transform: `translateX(${pos * span()}px)` }}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          ›
        </div>
      </div>
      <button
        type="button"
        className="slide-confirm__cancel"
        aria-label="Cancel"
        onClick={onCancel}
      >
        ×
      </button>
    </div>
  )
}
