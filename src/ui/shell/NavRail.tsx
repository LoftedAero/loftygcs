import { TABS, useUiStore } from '../../stores/ui-store'

// The Setup rail. Shown only in Setup mode -- Fly and Mission take the whole
// window. App-specific styling (app.css), built from the system tokens, with
// the brand-orange accent marking the active item.
export default function NavRail() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  return (
    <nav className="app-nav" aria-label="Setup sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === activeTab ? 'app-nav__item app-nav__item--active' : 'app-nav__item'}
          aria-current={tab.id === activeTab ? 'page' : undefined}
          onClick={() => setTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
