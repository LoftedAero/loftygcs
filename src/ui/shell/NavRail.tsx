import { Fragment } from 'react'
import { holdsVehicleTabs, useUiStore, visibleTabs } from '../../stores/ui-store'
import { useConnectionStore } from '../../stores/connection-store'

// The Setup rail, shown only in Setup mode.
//
// Group headings are emitted wherever the group changes in the filtered tab
// list, so a group disappears when none of its tabs are visible. With nothing
// connected, only offline-capable tabs are listed.
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
            // Presentational: the buttons carry the accessible names.
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
