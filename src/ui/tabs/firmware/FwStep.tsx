import type { ReactNode } from 'react'

/**
 * One numbered step and its controls. Numbered because each step depends on
 * the previous one. Controls share one width (`--fw-control-w`) so they line
 * up on a single left edge.
 */
export default function Step({
  n,
  label,
  htmlFor,
  wide,
  children,
}: {
  n: number
  label: string
  htmlFor?: string
  /** The vehicle strip is a grid of its own and takes the whole column. */
  wide?: boolean
  children: ReactNode
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="fw-step">
      <Label className="fw-step__label" {...(htmlFor ? { htmlFor } : {})}>
        <span className="fw-step__n" aria-hidden="true">
          {n}
        </span>
        {label}
      </Label>
      <div className={`fw-step__body${wide ? ' fw-step__body--wide' : ''}`}>{children}</div>
    </div>
  )
}
