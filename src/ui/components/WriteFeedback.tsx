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
export default function WriteFeedback({
  params,
  prefixes,
  inline,
}: {
  /** Answer only for these parameters, exactly. */
  params?: readonly string[]
  /** Answer only for parameters starting with one of these. */
  prefixes?: readonly string[]
  /**
   * A mark beside the control that wrote, rather than a sentence under a card.
   *
   * A tick or a cross, not a word. "Saved" needed 68px of room kept clear
   * beside every control that might show it, which a 77px PWM box in a table
   * of them cannot give up -- and the room had to be permanent, or the layout
   * moved every time a write landed. A glyph needs 16px and says the same
   * thing. The words survive for screen readers and in the hover, where the
   * failure can be a full sentence rather than two words.
   */
  inline?: boolean
}) {
  const latest = useWriteFeedbackStore((s) => s.latest)
  const clear = useWriteFeedbackStore((s) => s.clear)
  // The store keeps one slot for the whole app, so each instance answers only
  // for what it owns -- otherwise every field on a screen said "Saved" for a
  // change made in one of them.
  const scoped = params !== undefined || prefixes !== undefined
  const mine =
    latest &&
    (!scoped ||
      params?.includes(latest.param) ||
      prefixes?.some((p) => latest.param.startsWith(p)))
      ? latest
      : null
  const [shown, setShown] = useState(mine)

  useEffect(() => {
    setShown(mine)
    if (!mine || !mine.ok) return
    const t = setTimeout(() => {
      setShown(null)
      clear()
    }, FADE_MS)
    return () => clearTimeout(t)
    // `at` rather than the object: two writes of the same parameter are two
    // pieces of news, and the timer has to restart for the second.
  }, [mine?.at, mine, clear])

  const base = inline ? 'write-feedback write-feedback--inline' : 'write-feedback'
  if (!shown) return <span className={base} role="status" aria-live="polite" />

  const failure = `${shown.param} was not saved${shown.error ? ` — ${shown.error}` : ''}. It is still staged.`
  const success = `${shown.param} saved.`
  return (
    <span
      className={`${base} write-feedback--${shown.ok ? 'ok' : 'bad'}`}
      role="status"
      aria-live="polite"
      title={inline ? (shown.ok ? success : failure) : undefined}
    >
      {inline ? (
        <>
          <Mark ok={shown.ok} />
          {/* The words the glyph replaced, for anything that cannot see it.
              `aria-live` was already announcing them and still does. */}
          <span className="app-sr-only">{shown.ok ? success : failure}</span>
        </>
      ) : shown.ok ? (
        'Saved'
      ) : (
        <>
          <strong>{shown.param}</strong> was not saved
          {shown.error ? ` — ${shown.error}` : ''}. It is still staged.
        </>
      )}
    </span>
  )
}

/**
 * The tick and the cross.
 *
 * Shape as well as colour, which is this app's rule wherever a state is
 * signalled -- the live mode-switch row carries a filled dot beside its tint
 * for the same reason. Drawn here rather than taken from an icon set: two
 * glyphs is not a reason to take one on, and they have to follow
 * `currentColor` so the ok and bad tones reach them.
 */
function Mark({ ok }: { ok: boolean }) {
  return (
    <svg className="write-feedback__mark" viewBox="0 0 16 16" aria-hidden="true">
      {ok ? (
        <path
          d="M3 8.5 6.5 12 13 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M4 4 12 12M12 4 4 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}
