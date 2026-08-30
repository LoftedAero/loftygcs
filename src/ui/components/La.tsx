// Thin typed wrappers over the Lofted Aero design system. Each one emits
// exactly the markup shape DESIGN.md documents -- the wrapper exists so a
// React component cannot drift from that shape, not to add behavior.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type BtnSize = 'sm' | 'lg' | 'block'

export function LaButton({
  variant = 'secondary',
  size,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  const cls = ['la-btn', `la-btn--${variant}`, size ? `la-btn--${size}` : '', className]
    .filter(Boolean)
    .join(' ')
  return <button className={cls} {...rest} />
}

export function LaLinkButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="la-link-btn" {...props} />
}

export function LaCard({
  title,
  subtitle,
  note,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  note?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={`la-card ${className}`.trim()}>
      {title && <h2 className="la-card__title">{title}</h2>}
      {subtitle && <p className="la-card__subtitle">{subtitle}</p>}
      {children}
      {note && <p className="la-card__note">{note}</p>}
    </section>
  )
}

export function LaField({
  label,
  unit,
  htmlFor,
  stacked,
  children,
}: {
  label: string
  unit?: string
  htmlFor?: string
  stacked?: boolean
  children: ReactNode
}) {
  return (
    <div className={stacked ? 'la-field la-field--stacked' : 'la-field'}>
      <label className="la-field__label" htmlFor={htmlFor}>
        {label} {unit && <span className="la-field__unit">{unit}</span>}
      </label>
      {children}
    </div>
  )
}

export function LaInput({
  num,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { num?: boolean }) {
  const cls = ['la-input', num ? 'la-input--num' : '', className].filter(Boolean).join(' ')
  return <input className={cls} {...rest} />
}

export function LaSelect({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`la-select ${className}`.trim()} {...rest} />
}

export function LaSwitch({
  label,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  // The input must stay a sibling *before* the track (DESIGN.md §4).
  return (
    <label className="la-switch">
      <span className="la-field__unit">{label}</span>
      <input type="checkbox" {...rest} />
      <span className="la-switch__track"></span>
    </label>
  )
}

export function LaLed({
  state,
  dot,
  label,
  title,
}: {
  state: 'ok' | 'bad' | 'idle'
  dot: ReactNode
  label: string
  title: string
}) {
  // Color alone is never the signal: the dot carries a glyph and the title
  // says the state in words. Callers must set state and title together.
  return (
    <span className={`la-led la-led--${state}`} title={title}>
      <span className="la-led__dot">{dot}</span>
      <span className="la-led__label">{label}</span>
    </span>
  )
}

export function LaReadout({
  value,
  placeholder,
  wide,
}: {
  value?: string | undefined
  placeholder: string
  wide?: boolean
}) {
  return (
    <div
      className={wide ? 'la-readout la-readout--wide' : 'la-readout'}
      data-placeholder={placeholder}
    >
      {value}
    </div>
  )
}

export function LaHint({ error, children }: { error?: boolean; children?: ReactNode }) {
  // Left in the markup even when empty -- an empty hint collapses, and
  // keeping the element means a message never reflows the card when it
  // appears.
  return <p className={error ? 'la-hint la-hint--error' : 'la-hint'}>{children}</p>
}

export function LaModal({
  open,
  toast,
  wide,
  title,
  children,
  actions,
}: {
  open: boolean
  toast?: boolean
  /** The wider card DESIGN.md defines, for dialogs with a diagram or a table. */
  wide?: boolean
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  const cls = ['la-modal', toast ? 'la-modal--toast' : '', open ? '' : 'hidden']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      <div className={wide ? 'la-modal__card la-modal__card--wide' : 'la-modal__card'}>
        <h2 className="la-modal__title">{title}</h2>
        <div className="la-modal__body">{children}</div>
        {actions && <div className="la-modal__actions">{actions}</div>}
      </div>
    </div>
  )
}
