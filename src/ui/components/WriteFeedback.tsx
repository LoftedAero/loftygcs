import { useEffect, useState } from 'react'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'

/** How long a success stays up. Long enough to notice, short enough to ignore. */
const FADE_MS = 2200

// The answer to "did that land?", for screens that write as you go.
//
// A success fades; a failure does not. They are not the same news: a write
// that worked needs only to be seen once, while a write that did not leaves
// the control showing a value the vehicle does not have, and that is worth
// keeping on screen until something else happens.
//
// It is `aria-live` so the answer reaches somebody who is not watching this
// corner of the screen, and `polite` rather than `assertive` because it must
// not interrupt: this is confirmation, not an alarm.
export default function WriteFeedback() {
  const latest = useWriteFeedbackStore((s) => s.latest)
  const clear = useWriteFeedbackStore((s) => s.clear)
  const [shown, setShown] = useState(latest)

  useEffect(() => {
    setShown(latest)
    if (!latest || !latest.ok) return
    const t = setTimeout(() => {
      setShown(null)
      clear()
    }, FADE_MS)
    return () => clearTimeout(t)
    // `at` rather than the object: two writes of the same parameter are two
    // pieces of news, and the timer has to restart for the second.
  }, [latest?.at, latest, clear])

  if (!shown) return <div className="write-feedback" role="status" aria-live="polite" />

  return (
    <div
      className={`write-feedback write-feedback--${shown.ok ? 'ok' : 'bad'}`}
      role="status"
      aria-live="polite"
    >
      {shown.ok ? (
        'Saved'
      ) : (
        <>
          <strong>{shown.param}</strong> was not saved
          {shown.error ? ` — ${shown.error}` : ''}. It is still staged.
        </>
      )}
    </div>
  )
}
