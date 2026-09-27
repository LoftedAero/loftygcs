import { useEffect, useState } from 'react'
import { useWriteFeedbackStore } from '../../stores/write-feedback-store'

/** How long a success stays up. */
const FADE_MS = 2200

// Write confirmation for screens that write as you go.
//
// A success fades; a failure stays, because the control is then showing a
// value the vehicle does not have.
//
// `aria-live="polite"`: a confirmation, not an alarm.
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
   * A tick or cross beside the control, rather than a sentence under the
   * card. A glyph needs 16px of permanently reserved room where a word needs
   * far more. The full text is kept for screen readers and the tooltip.
   */
  inline?: boolean
}) {
  const latest = useWriteFeedbackStore((s) => s.latest)
  const clear = useWriteFeedbackStore((s) => s.clear)
  // The store keeps one slot for the whole app, so each instance answers only
  // for the parameters it owns.
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
    // Keyed on `at` so a second write of the same parameter restarts the timer.
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
          {/* The text for screen readers. */}
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
 * The tick and the cross: state is signaled by shape as well as color. Drawn
 * inline so they follow `currentColor`.
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
