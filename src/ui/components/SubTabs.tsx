// A second level of tabs *inside* one setup screen.
//
// The rail answers "which part of the aircraft", and a screen that answers
// two different questions about the same part wants a switch of its own --
// the Inspector's messages-versus-hardware, Tuning's loops-versus-navigation.
// Betaflight does the same thing on its PID screen (PID / Rates / Filter),
// and for the same reason: those cards would all fit on one page, but they
// belong to different sittings.
//
// Shared rather than copied. The actions column is the cautionary tale in
// this codebase -- three screens each grew a private version and each picked
// a different width -- and a tab strip has exactly the same failure mode.
export interface SubTab<Id extends string> {
  id: Id
  label: string
}

export default function SubTabs<Id extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: readonly SubTab<Id>[]
  active: Id
  onChange: (id: Id) => void
  /** Names the strip for assistive tech: "Inspector view", "Tuning view". */
  label: string
}) {
  return (
    <div className="app-subtabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`app-subtab${active === t.id ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
