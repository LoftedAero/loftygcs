// A second level of tabs inside one setup screen, for a screen with two
// distinct views of the same subject (the Inspector's messages and hardware,
// Tuning's loops and navigation). Shared so each screen does not grow its own.
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
