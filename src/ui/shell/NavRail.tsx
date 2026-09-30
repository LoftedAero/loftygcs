import { Fragment } from 'react'
import BarPopover from './BarPopover'
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

/**
 * The rail for compact mode, which has no room for a column: the mode
 * switch's Setup button names the current screen and opens every screen,
 * grouped as on the rail.
 */
export function SetupScreenPicker() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const connected = useConnectionStore((s) => holdsVehicleTabs(s.phase))
  const tabs = visibleTabs(connected)
  const groups = [...new Set(tabs.map((t) => t.group))]
  const current = tabs.find((t) => t.id === activeTab)
  return (
    <BarPopover
      className="app-modes__item app-modes__item--active app-screen-pick"
      panelClassName="app-screens"
      label="Setup screens"
      title="Setup screens"
      button={
        <>
          <span className="app-screen-pick__name">{current?.label ?? 'Setup'}</span>
          <svg className="app-screen-pick__chevron" viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" />
          </svg>
        </>
      }
    >
      {(close) =>
        groups.map((g) => (
          // The rail's own group and item styles.
          <section key={g} className="app-screens__group" aria-label={g}>
            <p className="app-nav__group" aria-hidden="true">
              {g}
            </p>
            <div className="app-screens__list">
              {tabs
                .filter((t) => t.group === g)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={
                      t.id === activeTab ? 'app-nav__item app-nav__item--active' : 'app-nav__item'
                    }
                    aria-current={t.id === activeTab ? 'page' : undefined}
                    onClick={() => {
                      setTab(t.id)
                      close()
                    }}
                  >
                    {t.label}
                  </button>
                ))}
            </div>
          </section>
        ))
      }
    </BarPopover>
  )
}
