import { Fragment } from 'react'
import { holdsVehicleTabs, useUiStore, visibleTabs } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'

// The Setup rail. Shown only in Setup mode -- Fly and Mission take the whole
// window. App-specific styling (app.css), built from the system tokens, with
// the brand-orange accent marking the active item.
//
// Headings come from the tab list rather than from a second structure here:
// one array stays one array, and a tab cannot end up in a group the rail
// does not draw. The heading is emitted where the group changes, so adding a
// tab needs nothing of this file -- including the group vanishing when the
// last tab in it does, which is why the heading is emitted from the filtered
// list rather than from `TABS`.
//
// With nothing connected the rail lists only what can be done now. Mission
// Planner does the same and says so in its wiki; the alternative this
// replaced was a card on each vehicle-only tab describing the screen you
// could not use, which is a thing none of QGC, Mission Planner or Betaflight
// does.
export default function NavRail() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const connected = useConnectionStore((s) => holdsVehicleTabs(s.phase))
  const tabs = visibleTabs(connected)
  return (
    <nav className="app-nav" aria-label="Setup sections">
      {tabs.map((tab, i) => (
        <Fragment key={tab.id}>
          {tab.group !== tabs[i - 1]?.group && (
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
