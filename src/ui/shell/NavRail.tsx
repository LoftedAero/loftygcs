import { Fragment } from 'react'
import { TABS, useUiStore } from '../../stores/ui-store'

// The Setup rail. Shown only in Setup mode -- Fly and Mission take the whole
// window. App-specific styling (app.css), built from the system tokens, with
// the brand-orange accent marking the active item.
//
// Headings come from the tab list rather than from a second structure here:
// one array stays one array, and a tab cannot end up in a group the rail
// does not draw. The heading is emitted where the group changes, so adding a
// tab needs nothing of this file.
export default function NavRail() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  return (
    <nav className="app-nav" aria-label="Setup sections">
      {TABS.map((tab, i) => (
        <Fragment key={tab.id}>
          {tab.group !== TABS[i - 1]?.group && (
            // Presentational: the buttons already carry the accessible names
            // and `aria-current`, and a heading between them would only add
            // a landmark to step through.
            <p className="app-nav__group" aria-hidden="true">
              {tab.group}
            </p>
          )}
          <button
            className={
              tab.id === activeTab ? 'app-nav__item app-nav__item--active' : 'app-nav__item'
            }
            aria-current={tab.id === activeTab ? 'page' : undefined}
            onClick={() => setTab(tab.id)}
          >
            {tab.label}
          </button>
        </Fragment>
      ))}
    </nav>
  )
}
